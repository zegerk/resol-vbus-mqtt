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

/**
 * Mapping topics to parameters
 */
let mqttMessageMap = {};

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

/**
 * Config for get / set action
 * 
 * @todo configurable
 */
const actionOptions = {
    timeout: 50,
    timeoutIncr: 100,
    tries: 2,
};

const actionWriteOptions = {
    timeout: 250,
    timeoutIncr: 250,
    tries: 6,
    save: true,
};

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
    let datagram = await waitForFreeBus();
    logger.debug('Free VBus, fetching master address...');

    logger.debug(`Free bus datagram ${JSON.stringify(datagram)}`);
    masterAddress = datagram.sourceAddress

    logger.info(`VBus master address ${masterAddress}`);

    logger.debug('Releasing VBus');
    await releaseBus(masterAddress);
    logger.debug('Released VBus');
};

const startHeaderSetConsolidatorTimer = async () => {
    logger.debug('Starting HeaderSetConsolidator timer...');

    headerSetConsolidator.startTimer();
};

/**
 * @todo makke this more configurable
 * 
 * @param {string} key 
 * @param {boolean} write 
 * @returns {string}
 */
const getMqttTopic = (key, write = false) => {
    let topic = key ? config.mqttTopic + '/' + key
                    : config.mqttTopic;
    
    if (write) {
        topic += '/set';
    }

    return topic;
}

/**
 * Code to keep local control of the bus using
 * a semaphore
 */
let busFree = true

const waitForFreeBus = async () => {
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    let tries = 0;

    /**
     * @todo wait and tries should be configurable
     */
    while (!busFree) {
        await wait(100);
        tries++;

        if (tries > 50) {
            return false;
        }
    }

    busFree = false;

    return connection.waitForFreeBus();   
}

const releaseBus = async (masterAddress) => {
    const result = await connection.releaseBus(masterAddress);  
     
    busFree = true;

    return result;
}

/**
 * Handle the setting of values
 * 
 * @param {string} topic 
 * @param {string} message 
 */
const onMqttMessage = async (topic, message) => {
    if (mqttMessageMap[topic]) {
        const { key, valueConfig } = mqttMessageMap[topic];
        logger.debug(`Topic config ${key} ${JSON.stringify(valueConfig)}`);

        const freeBusResult = await waitForFreeBus();
                
        if (freeBusResult) {
            logger.debug(`Setting value free bus ${JSON.stringify(freeBusResult)}`);

            const type = valueConfig.type;

            /**
             * @todo assumes it is numeric!
             */
            let value = parseFloat(message);

            if (value > type.max || value < type.min) {
                logger.error(`Value for ${key} out of range ${value} ${min} ${max}`);
            } else {
                /**
                 * Convert to internal value
                 */
                value = (parseInt(value) * (10**type.precision)).toString();
    
                const datagram = await connection.setValueById(
                    masterAddress, 
                    valueConfig.id, 
                    value,
                    actionWriteOptions,
                );

                logger.debug(`Setting value to ${value} for ${key} datagram ${JSON.stringify(datagram)}`);
            }

            await releaseBus(masterAddress);

        } else {
            logger.error('Timed out on waiting for free bus when setting value')
        }
    }
}

const startMqttLogging = async () => {

    /**
     * Called every cycle
     *
     * @param {*} headerSet 
     * @param {*} client 
     */
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
                client.publish(getMqttTopic(key), value);
            }     
        }

        if (payload) {
            client.publish(getMqttTopic(), payload);       
        }

        /**
         * Now the header information has been retrieved we switch 
         * to other vars not in the header
         * 
         * https://github.com/danielwippermann/resol-vbus/examples/customizer/index.js
         */
        if (busFree) {
            await waitForFreeBus();

            for (const [key, valueConfig] of Object.entries(config.mqttPacketFieldMap.values)) {
                // https://gist.github.com/zegerk/9b27d7a962da28b28f07eb6b01db0572
                let datagram = await connection.getValueById(
                    masterAddress, 
                    valueConfig.id, 
                    actionOptions
                );

                if (datagram) {
                    let value = datagram.value;

                    logger.debug(`${key} datagram ${JSON.stringify(datagram)}`);

                    /**
                     * @todo should not be here
                     */
                    if (valueConfig.type && valueConfig.type.precision) {
                        value = 
                            (value / (valueConfig.type.precision * 10)).
                            toFixed(valueConfig.type.precision);
                    }
                    
                    client.publish(getMqttTopic(key), value.toString());
                }
            }

            /**
             * Done, release the bus
             */
            await releaseBus(masterAddress);
        }
    };

    if (config.mqttInterval) {
        logger.debug('Starting MQTT logging');
        const client = mqtt.connect(config.mqttConnect);

        client.on('error', err => {
            logger.error(`MQTT client error ${err}`);
        });

        client.on('connect', () => {
            /**
             * Subscribe to writable topics
             */
            for (const [key, valueConfig] of Object.entries(config.mqttPacketFieldMap.values)) {
                if (valueConfig.writeable) {

                    const type = valueConfig.type
                    
                    /**
                     * Do not allow setting of values through mqtt if we cannot
                     * sanitize it
                     */
                    if (type && 'min' in type && 'max' in type  && 'precision' in type) {
                        const topic = getMqttTopic(key, true);

                        logger.info(`MQTT subscribing to ${topic}`);

                        mqttMessageMap[topic] = { key, valueConfig };

                        client.subscribe(topic, function (err) {
                            if (err) {
                                logger.error(`MQTT subscribe error ${err}`)
                            }
                        })
                    } else {
                        logger.error(`Setting values only allowed when min, max and precision are set (${key})`)
                    }
                }
            }

            client.on('message', function (topic, message) {
                message = message.toString();
                logger.debug(`MQTT message received ${topic} ${message}`);
                onMqttMessage(topic, message);
            })

            const hsc = new HeaderSetConsolidator({
                interval: config.mqttInterval,
            });

            hsc.on('headerSet', () => {
                onHeaderSet(headerSetConsolidator, client).then(null, err => {
                    logger.error(`Headerset consolidator error ${err}`);
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
