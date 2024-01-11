import {
    setUpRoleAndPolicy, tearDownRoleAndPolicy, createTopicRule, tearDownRule
} from '../util/test_environment_preparer.js';
import * as fs from 'fs';
import * as path from 'path';
import {TestMQTTClient} from "../util/mqtt/test-mqtt-client.js";
import {Device} from "../util/new-device.js";
import {config} from "../util/config.js";
import {InvalidRequestException, SqlParseException} from "@aws-sdk/client-iot";
import retry from "async-retry";

const generateRandomString = (length = 6) => Math.random().toString(20).substr(2, length);
const inputFileNameArg = process.argv.filter((fileNameArg) => fileNameArg.startsWith('-inputFile='))[0];
const inputFileName = inputFileNameArg ? inputFileNameArg.split('=')[1] : config.defaultInputFile // default

let client = null;
const clientId = 'test-client_' + generateRandomString();
const device = new Device({thingName: clientId});

let rulesToCleanUp = [];
let rolesAndPoliciesToCleanUp = [];

beforeAll(async () => {
    console.log('[Validate-IoT-Rules] Before Tests');
    let response = {};
    try {
        await device.createThing();
        response = await device.createKeysAndCertificate();
        await device.attachPolicyToCertificate(response);
        await device.attachCertificateToThing(response);
        config.endpoint = await device.configureEndpoint();
    } catch (e) {
        console.log('[Validate-IoT-Rules] Error setting up IoT Thing', e);
    }
    config.cert = response.certificate;
    config.key = response.key;
    config.clientId = clientId;

    //create thing, MQTT client, connect and subscribe.
    if (config.clientId && config.endpoint && config.cert && config.key) {
        client = new TestMQTTClient(config);
    }
});

afterAll(async () => {
    console.log('[Validate-IoT-Rules] ', new Date().toISOString(), ' Deleting IAM role with policy to republish');
    console.log('[Validate-IoT-Rules] ', new Date().toISOString(), ' Stopping MQTT client');
    await client.stop();
    console.log('[Validate-IoT-Rules] ', new Date().toISOString(), ' Cleaning up device');
    await device.cleanUp();
    //Cleaning up all the Roles and Policies which have not been cleant up. This can happen in case unexpected expections were thrown and tests failed.
    if(rolesAndPoliciesToCleanUp.length > 0) {
        console.log('[Validate-IoT-Rules] ', new Date().toISOString(), ' Starting Roles and Policies Clean-Up');
        await tearDownRolesAndPolicies();
    }
    //Cleaning up all created Rules that have not been cleant up.This can happen in case unexpected expections were thrown and tests failed.
    if(rulesToCleanUp.length > 0) {
        console.log('[Validate-IoT-Rules] ', new Date().toISOString(), ' Starting Rules Clean-Up');
        await tearDownRules();
    }
});

describe('Verify IoT Rule Test Suite', () => {
    const directoryPath = path.join(__dirname, 'validation-data');
    let validationData = [];

    console.log('[Validate-IoT-Rules] Starting validation with input file: ', inputFileName);

    if (inputFileName === 'ALL') {
        const files = fs.readdirSync(directoryPath);
        for (let i = 0; i < files.length; i++) {
            const filePath = path.join(directoryPath, files[i]);
            const json = JSON.parse(fs.readFileSync(filePath).toString());
            validationData.push({
                sqlVersion: json.sqlVersion,
                topic: json.topic,
                inputSql: json.inputSql,
                inputPayload: json.inputPayload,
                expectedOutput: json.expectedOutput
            })
        }
    } else {
        const filePath = path.join(directoryPath, inputFileName);
        const json = JSON.parse(fs.readFileSync(filePath).toString());
        validationData.push({
            sqlVersion: json.sqlVersion,
            topic: json.topic,
            inputSql: json.inputSql,
            inputPayload: json.inputPayload,
            expectedOutput: json.expectedOutput
        })
    }

    it.each(validationData)('Verify IoT Rule Test Case - Input: %s', async ({
                                                                                sqlVersion,
                                                                                topic,
                                                                                inputSql,
                                                                                inputPayload,
                                                                                expectedOutput
                                                                            }) => {
        console.log('[Validate-IoT-Rules] Creating IAM role with policy to republish');
        const rolePolicyInfo = await setUpRoleAndPolicy();
        rolesAndPoliciesToCleanUp.push(rolePolicyInfo);
        expect(rolePolicyInfo).not.toEqual({});
        let REPUBLISH_TOPIC = `republish/${clientId}/${generateRandomString(2)}`;
        let actualOutput = null;
        //expected output can be a JSON or a string.
        const expectedOutputString = (typeof expectedOutput === 'string') ? expectedOutput : JSON.stringify(expectedOutput);

        const ruleName = 'TestRule_' + generateRandomString();
        const res = await retry(async (bail) => {
            const sqlVersionString = sqlVersion ? sqlVersion : '2016-03-23';
            let result = null;
            try {
                result = await createTopicRule(inputSql, sqlVersionString, ruleName, REPUBLISH_TOPIC, rolePolicyInfo.roleArn);
            } catch (e) {
                if(e instanceof InvalidRequestException) {
                    throw new Error('[Validate-IoT-Rules] Error creating rule. Might need to wait for the role to be persisted.')
                }

                if(e instanceof SqlParseException) {
                    bail(new Error(`[Validate-IoT-Rules] Error creating rule. Invalid SQL. ${e.message}`));
                    return
                }

                throw new Error(`[Validate-IoT-Rules]  Error creating rule. ${e.name}`)
            }
            
            return result;
        }, {
            retries: 5, //use 10 retries as lib default.
            onRetry: () => {
                console.log('[Validate-IoT-Rules] trying again to create the Rule... ');
            }
        });
        expect(res?.$metadata?.httpStatusCode).toBe(200);
        rulesToCleanUp.push(ruleName);

        console.log('[Validate-IoT-Rules] ', new Date().toISOString(), ' Created IoT Rule', ruleName, res);

        const result = await client.start();
        console.log('[Validate-IoT-Rules] ', new Date().toISOString(), ' StartResult', result);
        expect(result).toBeTruthy();

        const output = await retry(async (bail) => {
            let handleResponse = null;
            const subResp = await client.subscribe(REPUBLISH_TOPIC, 1, (topic, payload) => {
                console.log(new Date().toISOString(), ' Received', topic, new TextDecoder().decode(payload));
                actualOutput = new TextDecoder().decode(payload);
                if (handleResponse) {
                    handleResponse(actualOutput);
                }
            });
            expect(subResp).toBeTruthy();

            const waitForMessageOrTimeout = (runWhenReady) => new Promise(async (resolve, reject) => {
                const timeout = setTimeout(async () => {
                    console.log(new Date().toISOString(), ' Timed out. ');
                    await client.unsubscribe(REPUBLISH_TOPIC);
                    reject(new Error('Error (probably timed out)'));
                }, 10 * 1000);
                handleResponse = (actualOutput) => {
                    clearTimeout(timeout);
                    handleResponse = null;
                    resolve(actualOutput);
                };
                await runWhenReady();
            });

            const output = await waitForMessageOrTimeout(async () => {
                console.log(new Date().toISOString(), ' Publishing');
                const pubResp = await client.publish(topic, inputPayload, 1, false);
                expect(pubResp).toBeTruthy();
            });
            return output;
        }, {
            retries: 3,
            onRetry: () => {
                console.log('[Validate-IoT-Rules] Here we are: trying again... ');
            }
        });

        expect(output).toEqual(expectedOutputString);

        await tearDownRoleAndPolicy(rolePolicyInfo.policyArn, rolePolicyInfo.roleName);
        rolesAndPoliciesToCleanUp = rolesAndPoliciesToCleanUp.filter((item) => {
            return item !== rolePolicyInfo
        });

        await tearDownRule(ruleName);
        rulesToCleanUp = rulesToCleanUp.filter((item) => {
            return item !== ruleName
        });

    }, 1200 * 1000);
});

const tearDownRules = async () => {
    await Promise.all(
        rulesToCleanUp.map(async (ruleName) => {
            const res = await retry(async (bail) => {
                const result = await tearDownRule(ruleName);
                if (!result) {
                    throw new Error('[Validate-IoT-Rules] Error deleting rule. Maybe Max TPS reached? Will retry.')
                }
                //TODO: consider to bail for certain errors. Must look in the SDk docs.
                return result;
            }, {
                retries: 5,
                onRetry: () => {
                    console.log('[Validate-IoT-Rules] Here we are: trying again to delete the Rule... ');
                }
            });
            expect(res).toBe(true);
        })
    );
}
const tearDownRolesAndPolicies = async () => {
    await Promise.all(
        rolesAndPoliciesToCleanUp.map(async (roleAndPolicy) => {
            const res = await retry(async (bail) => {
                const result = await tearDownRoleAndPolicy(roleAndPolicy.policyArn, roleAndPolicy.roleName);
                if (!result) {
                    throw new Error('[Validate-IoT-Rules] Error deleting role and policy. Maybe some Max TPS reached? Will retry.')
                }
                //TODO: consider to bail for certain errors. Must look in the SDk docs.
                return result;
            }, {
                retries: 5,
                onRetry: () => {
                    console.log('[Validate-IoT-Rules] Here we are: trying again to cleanup the role and policy... ');
                }
            });
            expect(res).toBe(true);
        })
    );
}