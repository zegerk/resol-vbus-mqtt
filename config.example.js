'use strict';

const path = require('path');

module.exports = {

    /**
     * Name of the Connection class to use to connect.
     */
    connectionClassName: 'TcpConnection',

    /**
     * Options for the Connection instance.
     */
    connectionOptions: {
        host: '127.0.0.1',
        password: 'password',
    },

    /**
     * Logging interval in milliseconds.
     */
    loggingInterval: 10000,

    /**
     * Logging time to live in milliseconds.
     */
    loggingTimeToLive: 60000,

    /**
     * Logging directory.
     */
    loggingPath: path.resolve(__dirname, 'cache'),

    /**
     * Text file logging interval in milliseconds. A value of zero disables this functionality.
     */
    textLoggingInterval: 0,

    /**
     * Text file logging time to live in milliseconds.
     */
    textLoggingTimeToLive: 60000,

    /**
     * Text file logging directory.
     */
    textLoggingPath: path.resolve(__dirname, 'log'),

    /**
     * Text file logging options, passed to the `TextConverter` constructor.
     */
    textLoggingOptions: {
        columnSeparator: '\t',
        lineSeparator: '\r\n',
        separateDateAndTime: false,
    },

    /**
     * Port number to bind the web server to.
     */
    webServerPort: 3000,

    /**
     * If your controller is not supported by the VBusTouch app directly, enable this
     * option and implement the rewrite behavoiur in the `rewriteHeaderSet` function.
     */
    rewriteWebHeaderSets: false,

    /**
     * Interval (milliseconds) in which data will be uploaded to MQTT. A value of zero disables this functionality.
     */
    mqttInterval: 5000,

    /**
     * MQTT connect parameters, https://github.com/mqttjs/MQTT.js#connect
     */
    mqttConnect: {
        host: '127.0.0.1',
    },

    /**
     * MQTT topic to publish to.
     */
    mqttTopic: 'resol',

    /**
     * Specifies how the MQTT payload is encoded. Supports 'json' (default) and 'urlencoded'.
     */
    mqttEncoding: 'json',

    /**
     * A map of MQTT message attributes to VBus packet field IDs.
     *
     * An example sensor in Home Assistant would be:
     * - platform: mqtt
     *    name: "Resol Collector Temp"
     *    state_topic: "home/resol"
     *    unit_of_measurement: '°C'
     *    value_template: "{{ value_json.temp1 }}"
     */
    mqttPacketFieldMap: {
        /**
         * Values are pulled from the master device
         */
        values: {
            counter: {
                id: 8227,
            },
            r1SpeedMin: {
                id: 8248,
            },
            r1SpeedMax: {
                id: 8257,
            }
        },
        header: {
            temp1: '00_0010_5611_10_0100_000_2_0',
            temp2: '00_0010_5611_10_0100_002_2_0',
            temp3: '00_0010_5611_10_0100_004_2_0',
            temp4: '00_0010_5611_10_0100_006_2_0',
            relay1: '00_0010_5611_10_0100_008_1_0',
            relay2: '00_0010_5611_10_0100_009_1_0',
            mixerOpen: '00_0010_5611_10_0100_010_1_0',
            mixerClosed: '00_0010_5611_10_0100_011_2_0',
            systemMessage: '00_0010_5611_10_0100_018_1_0',
            date: '00_0010_5611_10_0100_012_4_0',
            time: '00_0010_5611_10_0100_016_2_0',

            /**
             * Taken from the header
             */
            pumpSpeed1:    '00_8015_F54C_10_5AD5_00_0015_5611_10_0100_01_08_4_004_1_0',
            error:         '00_8015_F54C_10_5AD5_00_0015_5611_10_0100_01_0B_1_004_4_0',
            heatQuantity1: '00_8015_F76C_10_3ECC_00_0015_5611_10_0100_02_0A_1_008_4_0',
            heatQuantity2: '00_8015_4AF9_10_A85F_00_0015_5611_10_0100_01_05_1_004_4_0',
        }
    },
};
