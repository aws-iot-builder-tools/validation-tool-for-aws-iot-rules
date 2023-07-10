import {AwsIotMqttConnectionConfigBuilder} from 'aws-crt/dist/native/aws_iot.js';
import {ClientBootstrap} from 'aws-crt/dist/native/io.js';
import {MqttClient} from 'aws-crt/dist/native/mqtt.js';

export class TestMQTTClient {
    constructor(options = {}) {
        this._options = options;
        this._connected = false;
        this._clientId = this._options.clientId;
        this._cert = this._options.cert;
        this._key = this._options.key;
        this._connection = undefined;
        this._client = undefined;
        this._clientBootstrap = undefined;
    }

    async start() {
      console.log('[Start]', {clientId: this._clientId});
        try {
            if ((await this._createClient()) && (await this._configureConnection()) && (await this._connect())) {
              console.log('[Start_Started]', {clientId: this._clientId});
                return true;
            } else {
              console.log('[Start_NotStarted]', {clientId: this._clientId});
                return false;
            }
        } catch (error) {
          console.error('[Start_Error]', error)
            return false;
        }
    }

    async stop() {
      console.log('[Stop]', {clientId: this._clientId});
        const result = await this._disconnect();
        this._connected = false;
        this._connection = undefined;
        this._client = undefined;
        this._clientBootstrap = undefined;
        return result;
    }

    async publish(topic, payload, qos, retain) {
        if (!this._connection) {
          console.log('[Publish_ConnectionDoesNotExist]', {clientId: this._clientId});
            return false;
        }
        try {
            let request = await this._connection.publish(topic, payload, qos.valueOf(), retain);
            let processedResponse = {};
            if (!request || !request.packet_id) {
              console.log('[Publish]: Packet not sent, missing packet_id.');
            }
            return true;
        } catch (error) {
          console.error('[Publish_Error]', error);
            return false;
        }
    }

     async subscribe(topic, qos, onMessage) {
      console.log('[Subscribe]', {clientId: this._clientId, topic});
        if (!this._connection) {
          console.log('[Subscribe_ConnectionDoesNotExist]', {clientId: this._clientId});
            return false;
        }
        try {
            await this._connection.subscribe(topic, qos.valueOf(), onMessage);
            return true;
        } catch (error) {
          console.error('[Subscribe_Error]', error);
            return false;
        }
    }

    async unsubscribe(topic) {
      console.log('[Unsubscribe]', {clientId: this._clientId, topic});
        if (!this._connection) {
          console.log('[ConnectionDoesNotExist]', {clientId: this._clientId});
            return false;
        }
        try {
            await this._connection.unsubscribe(topic);
            return true;
        } catch (error) {
          console.error('[Unsubscribe_Error] ', error);
            return false;
        }
    }

    async _createClient() {
      console.log('[CreateClient]', {clientId: this._clientId});
        if (this._client) {
            return true;
        }
        this._clientBootstrap = this._clientBootstrapFactory();
        this._client = this._clientFactory();
      console.log('[CreateClient_Created]', {clientId: this._clientId});
        return true;
    }

    async _configureConnection() {
      console.log('[ConfigureConnection]', {clientId: this._clientId});
        if (!this._client || !this._clientBootstrap) {
            return false;
        }
        if (this._connection) {
            return true;
        }
        const config = this._mqttConnectionConfigFactory();
        this._connection = this._client.new_connection(config);
        if (!this._connection) {
          console.log('[ConfigureConnection_NotCreated]', {clientId: this._clientId});
            return false;
        }
        this._connection.on('connect', (sessionPresent) => {
          console.log('[ConfigureConnection_OnConnect]', {clientId: this._clientId, sessionPresent});
            this._connected = true;
        });
        this._connection.on('disconnect', () => {
          console.log('[ConfigureConnection_OnDisconnect]', {clientId: this._clientId});
            this._connected = false;
        });
        this._connection.on('error', (error) => {
          console.log('[ConfigureConnection_OnError]', {clientId: this._clientId, error: error.toString()});
            // Example: Failed to connect: aws-c-io: AWS_IO_DNS_INVALID_NAME, Host name was invalid for dns resolution.
        });
        this._connection.on('interrupt', (error) => {
          console.log('[ConfigureConnection_OnInterrupt]', {
                clientId: this._clientId,
                error: error.toString()
            });
            // Example: libaws-c-mqtt: AWS_ERROR_MQTT_UNEXPECTED_HANGUP, The connection was closed unexpectedly.
            // Example: libaws-c-mqtt: AWS_ERROR_MQTT_TIMEOUT, Time limit between request and response has been exceeded.
        });
        this._connection.on('resume', (returnCode, sessionPresent) => {
          console.log('[ConfigureConnection_OnResume]', {
                clientId: this._clientId,
                returnCode,
                sessionPresent
            });
            this._connected = true;
        });
        this._connection.on('message', (topic, payload) => {
          console.log('[ConfigureConnection_OnMessage]', {
                clientId: this._clientId,
              topic, payload
            });
        });

        const handleError = (error) => {
            if (error.toString && error.toString().includes('AWS')) {
              console.error('[Error]', error)
            } else {
              console.log('[Error]', error)
                throw error;
            }
        };
        process.on('uncaughtException', handleError);
        process.on('unhandledRejection', handleError);
        console.log('[ConfigureConnectionConfigured]', {clientId: this._clientId});
        return true;
    }

    async _connect() {
      console.log('[Connect]', {clientId: this._clientId});
        if (!this._connection) {
            return false;
        }
        if (this._connected) {
            return true;
        }
        try {
            const connectionIsNew = await this._connection.connect();
            console.log('[Connect_Connected]', {clientId: this._clientId, connectionIsNew});
            return true;
        } catch (error) {
          console.error('[Connect_Error]', error)
            return false;
        }
    }

    async _disconnect() {
      console.log('[Disconnect]', {clientId: this._clientId});
        if (!this._connection) {
            return false;
        }
        try {
            await this._connection.disconnect();
          console.log('[Disconnect_Disconnected]', {clientId: this._clientId});
            return true;
        } catch (error) {
          console.error('[Disconnect_Error]', error)
            return false;
        }
    }

    _mqttConnectionConfigFactory() {
        const configBuilder = AwsIotMqttConnectionConfigBuilder.new_mtls_builder(this._cert, this._key);
        configBuilder.with_clean_session(false);
        configBuilder.with_endpoint(this._options.endpoint);
        configBuilder.with_client_id(this._clientId);
        configBuilder.with_keep_alive_seconds(this._options.keepAlive || 30);
        return configBuilder.build();
    }

    _clientBootstrapFactory() {
        return new ClientBootstrap();
    }

    _clientFactory() {
        if (!this._clientBootstrap) {
            throw new Error('clientBootstrap is not defined');
        }
        return new MqttClient(this._clientBootstrap);
    }

    get connected() {
        return this._connected;
    }
}
