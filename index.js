/**
 * Based on code by Daniel Wipperman
 * 
 * ref: https://github.com/danielwippermann/resol-vbus/tree/master/examples/vbustouch-proxy
 * 
 * Code is optimized for sending Resol FSK data to Home Assistant 
 * through MQTT
 * 
 */
'use strict';

const winston = require('winston');
const mqtt = require('mqtt');

const {
    Converter,
    FileSystemRecorder,
    HeaderSet,
    HeaderSetConsolidator,
    SerialConnection,
    Specification,
    TcpConnection,
} = require('resol-vbus');

let connection = false;
let masterAddress = false;

const config = require('./config');

const specification = Specification.getDefaultSpecification();

const logger = winston.createLogger({
    transports: [
        new winston.transports.Console({
            level: 'debug',
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            ),
        }),
    ],
});

const connectionClassByName = {
    SerialConnection,
    TcpConnection,
};

const headerSetConsolidator = new HeaderSetConsolidator({
    interval: config.loggingInterval,
    timeToLive: config.loggingTimeToLive,
});

/**
 * This function is called once the header set is considered "settled".
 * That means that the amount of unique packets in the header set has
 * been stable for a certain amount of time.
 *
 * @param {HeaderSet} headerSet
 */
const headerSetHasSettled = function(headerSet) {
    const packetFields = specification.getPacketFieldsForHeaders(headerSet.getHeaders());
    const blockTypeSections = specification.getBlockTypeSectionsForHeaders(headerSet.getHeaders());
    const blockTypeFields = specification.getBlockTypeFieldsForSections(blockTypeSections);

    /**
     * Log the whole thing
     */
    logger.debug(packetFields.concat(blockTypeFields).map((field) => {
        return field.id + ': ' + field.name;
    }).join('\n'));
};

/**
 * Connect to the VBus and store the packets into the global HeaderSetConsolidator.
 */
const connectToVBus = async () => {
    const ConnectionClass = connectionClassByName [config.connectionClassName];
 
    connection = new ConnectionClass(config.connectionOptions);

    connection.on('connectionState', (connectionState) => {
        logger.debug('Connection state changed to ' + connectionState);
    });

    let hasSettled = false;
    let headerSet = new HeaderSet();
    let settledCountdown = 0;

    connection.on('packet', (packet) => {
        // logger.debug('Packet received...', packet);

        if (!hasSettled) {
            const headerCountBefore = headerSet.getHeaderCount();
            headerSet.addHeader(packet);
            const headerCountAfter = headerSet.getHeaderCount();

            if (headerCountBefore !== headerCountAfter) {
                settledCountdown = headerCountAfter * 2;
            } else if (settledCountdown > 0) {
                settledCountdown -= 1;
            } else {
                hasSettled = true;

                headerSetHasSettled(headerSet);
                
                headerSet = null;
            }
        }

        headerSetConsolidator.addHeader(packet);
    });

    logger.debug('Connecting to VBus...');

    await connection.connect();

    logger.debug('Connected to VBus...');

    /**
     * Fetch the master address
     */
    logger.debug('Waiting for free VBus...');
    let datagram = await connection.waitForFreeBus();
    logger.debug('Free VBus, fetching master address...');

    logger.debug(`Free bus datagram ${JSON.stringify(datagram)}`);
    masterAddress = datagram.sourceAddress

    logger.info(`VBus master address ${masterAddress}`);

    logger.debug('Releasing VBus');
    await connection.releaseBus(masterAddress);
    logger.debug('Released VBus');
};

const startHeaderSetConsolidatorTimer = async () => {
    logger.debug('Starting HeaderSetConsolidator timer...');

    headerSetConsolidator.startTimer();
};

const startMqttLogging = async () => {
    const onHeaderSet = async (headerSet, client) => {
        const headers = headerSet.getSortedHeaders();
        const packetFields = specification.getPacketFieldsForHeaders(headers);
        const blockTypeSections = specification.getBlockTypeSectionsForHeaders(headerSet.getHeaders());
        const blockTypeFields = specification.getBlockTypeFieldsForSections(blockTypeSections);

        const valuesById = packetFields.concat(blockTypeFields).reduce((memo, pf) => {
            if (pf.rawValue != null) {
                const precision = pf.packetFieldSpec.type.precision;

                const roundedRawValue = pf.rawValue.toFixed(precision);

                logger.debug(
                    'ID = ' + JSON.stringify(pf.id) + 
                    ', Name = ' + JSON.stringify(pf.name) + 
                    ', Value = ' + pf.rawValue + 
                    ', RoundedValue = ' + roundedRawValue
                );

                memo [pf.id] = roundedRawValue;
            }
            return memo;
        }, {});

        let payload;

        /**
         * @todo : the urlencoded is missing the values per topic code
         */
        if (config.mqttEncoding === 'urlencoded') {
            payload = Object.keys(config.mqttPacketFieldMap.header).reduce((memo, key) => {
                const packetFieldId = config.mqttPacketFieldMap.header[key];

                let value;
                if (typeof packetFieldId === 'function') {
                    value = packetFieldId(valuesById);
                } else {
                    value = valuesById [packetFieldId];
                }
                if (typeof value === 'number') {
                    value = value.toString();
                }
                if (typeof value === 'string') {
                    if (memo.length > 0) {
                        memo += '&';
                    }
                    memo += `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
                }
                return memo;
            }, '');
        } else {
            const params = Object.keys(config.mqttPacketFieldMap.header).reduce((memo, key) => {
                const packetFieldId = config.mqttPacketFieldMap.header[key];

                let value;
                if (typeof packetFieldId === 'function') {
                    value = packetFieldId(valuesById);
                } else {
                    value = valuesById [packetFieldId];
                }
                if (typeof value === 'number') {
                    value = value.toString();
                }
                if (typeof value === 'string') {
                    memo [key] = value;
                }
                return memo;
            }, {});

            payload = JSON.stringify({ ...params, ...{ heartbeat: new Date().toISOString() } });

            for (const [key, value] of Object.entries(params)) {
                client.publish(config.mqttTopic + '/' + key, value);
            }     
        }

        if (payload) {
            client.publish(config.mqttTopic, payload);       
        }

        /**
         * Now the header information has been retrieved we switch 
         * to other vars not in the header
         * 
         * https://github.com/danielwippermann/resol-vbus/examples/customizer/index.js
         */
        await connection.waitForFreeBus();

        // Should be configurable
        const actionOptions = {
            timeout: 50,
            timeoutIncr: 100,
            tries: 2,
        };

        for (const [key, valueConfig] of Object.entries(config.mqttPacketFieldMap.values)) {
            // https://gist.github.com/zegerk/9b27d7a962da28b28f07eb6b01db0572
            let datagram = await connection.getValueById(
                masterAddress, 
                valueConfig.id, 
                actionOptions
            );

            logger.debug(`${key} datagram ${JSON.stringify(datagram)}`);       
            
            client.publish(config.mqttTopic + '/' + key, datagram.value.toString());
        }

        /**
         * Done, release the bus
         */
        await connection.releaseBus(masterAddress);
    };

    if (config.mqttInterval) {
        logger.debug('Starting MQTT logging');
        const client = mqtt.connect(config.mqttConnect);

        client.on('error', err => {
            logger.error(err);
        });

        client.on('connect', () => {
            const hsc = new HeaderSetConsolidator({
                interval: config.mqttInterval,
            });

            hsc.on('headerSet', () => {
                onHeaderSet(headerSetConsolidator, client).then(null, err => {
                    logger.error(err);
                });
            });

            hsc.startTimer();
        });
    }
};

const main = async () => {
    await connectToVBus();

    await startHeaderSetConsolidatorTimer();

    await startMqttLogging();
};

if (require.main === module) {
    main(process.argv.slice(2)).then(() => {
        logger.info('Process started');
    }, err => {
        logger.error(`Main process error ${err}`);
    });
} else {
    module.exports = main;
}