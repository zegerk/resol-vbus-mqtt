/*! resol-vbus | Copyright (c) 2013-present, Daniel Wippermann | MIT license */
'use strict';

const path = require('path');

module.exports = {

    /**
     * Name of the Connection class to use to connect.
     */
    connectionClassName: process.env.CONNECTION_CLASS_NAME || 'TcpConnection',

    /**
     * Options for the Connection instance.
     */
    connectionOptions: {
        host: process.env.CONNECTION_OPTIONS_HOST,
        password: process.env.CONNECTION_OPTIONS_PASSWORD,
    },

    /**
     * Logging interval in milliseconds.
     */
    loggingInterval: parseInt(process.env.LOGGING_INTERVAL ?? "10000", 10),

    /**
     * Logging time to live in milliseconds.
     */
    loggingTimeToLive: parseInt(process.env.LOGGING_TIME_TO_LIVE ?? "60000", 10),

    /**
     * Interval (milliseconds) in which data will be uploaded to MQTT. A value of zero disables this functionality.
     */
    mqttInterval: parseInt(process.env.MQTT_INTERVAL ?? "5000", 10),

    /**
     * MQTT connect parameters, https://github.com/mqttjs/MQTT.js#connect
     */
    mqttConnect: {
        host: process.env.MQTT_CONNECT_HOST ?? 'mqtt://localhost',
        clientId: process.env.MQTT_CONNECT_CLIENT_ID,
        username: process.env.MQTT_CONNECT_USERNAME,
        password: process.env.MQTT_CONNECT_PASSWORD,
    },

    /**
     * MQTT topic to publish to.
     */
    mqttTopic: process.env.MQTT_TOPIC ?? 'resol',

    /**
     * Specifies how the MQTT payload is encoded. Supports 'json' (default) and 'urlencoded'.
     */
    mqttEncoding: process.env.MQTT_ENCODING ?? 'json',

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
    mqttPacketFieldMap: process.env.MQTT_PACKET_FIELD_MAP ? JSON.parse(process.env.MQTT_PACKET_FIELD_MAP) : {
        /**
         * Values are pulled from the master device
         */
        values: {
            counter: {
                id: 8227,
                writeable: false,
            },
            boilerTempMin: {
                id: 4113,
                type: {
                    precision: 1,
                    min: 10,
                    max: 80,
                },
                writeable: true,
            },
            boilerTempTarget: {
                id: 4110,
                type: {
                    precision: 1,
                    min: 30,
                    max: 85,
                },
                writeable: true,
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
    }
};
