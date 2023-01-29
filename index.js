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

const fsRecorder = new FileSystemRecorder({
    id: 'fs-destination',
    path: config.loggingPath,
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

    logger.debug(packetFields.concat(blockTypeFields).map((field) => {
        return field.id + ': ' + field.name;
    }).join('\n'));
};

/**
 * Connect to the VBus and store the packets into the global HeaderSetConsolidator.
 */
const connectToVBus = async () => {
    const ConnectionClass = connectionClassByName [config.connectionClassName];
    const connection = new ConnectionClass(config.connectionOptions);

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

                logger.debug('ID = ' + JSON.stringify(pf.id) + ', Name = ' + JSON.stringify(pf.name) + ', Value = ' + pf.rawValue + ', RoundedValue = ' + roundedRawValue);

                memo [pf.id] = roundedRawValue;
            }
            return memo;
        }, {});

        let payload;
        if (config.mqttEncoding === 'urlencoded') {
            payload = Object.keys(config.mqttPacketFieldMap).reduce((memo, key) => {
                const packetFieldId = config.mqttPacketFieldMap [key];

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
            const params = Object.keys(config.mqttPacketFieldMap).reduce((memo, key) => {
                const packetFieldId = config.mqttPacketFieldMap [key];

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

const startRecorder = async () => {
    const converter = new Converter({ objectMode: true });

    const onHeaderSet = function(headerSet) {
        // logger.debug('HeaderSet consolidated...');

        converter.convertHeaderSet(headerSet);
    };

    try {
        headerSetConsolidator.on('headerSet', onHeaderSet);

        await fsRecorder.record(converter, {
            interval: config.loggingInterval,
            timeToLive: config.loggingTimeToLive,
        });
    } finally {
        headerSetConsolidator.removeListener('headerSet', onHeaderSet);
    }
};


const main = async () => {
    await connectToVBus();

    await startHeaderSetConsolidatorTimer();

    await startMqttLogging();

    await startRecorder();
};



if (require.main === module) {
    main(process.argv.slice(2)).then(() => {
        logger.info('DONE!');
    }, err => {
        logger.error(err);
    });
} else {
    module.exports = main;
}