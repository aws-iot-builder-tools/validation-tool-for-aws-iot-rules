import {
    IoTClient,
    CreateThingCommand,
    CreatePolicyCommand,
    CreateKeysAndCertificateCommand,
    AttachPolicyCommand,
    AttachThingPrincipalCommand,
    DescribeEndpointCommand,
    ListThingPrincipalsCommand,
    DetachThingPrincipalCommand,
    DeleteThingCommand,
    DeletePolicyCommand,
    DetachPolicyCommand
} from "@aws-sdk/client-iot";
import {config} from "./config.js";

const client = new IoTClient({region: config.region});
const iotPolicyName = "iot_rule_test_policy";

export class Device {
    constructor(options = {}) {
        this._thingName = options.thingName;
    }

    get thingName() {
        return this._thingName;
    }

    async createThing() {
        console.info('[Device] Creating or Updating thing ', this.thingName);
        const command = new CreateThingCommand({thingName: this.thingName});
        return await client.send(command);
    }

    async createIoTPolicy() {
        const policyDocument =
            {
                Version: "2012-10-17",
                Statement: [
                    {
                        Effect: "Allow",
                        Action: "iot:Connect",
                        Resource: `arn:aws:iot:${config.region}:${config.accountId}:client/\${iot:ClientId}`
                    },
                    {
                        Effect: "Allow",
                        Action: "iot:Publish",
                        Resource: `arn:aws:iot:${config.region}:${config.accountId}:topic/*`
                    },
                    {
                        Effect: "Allow",
                        Action: "iot:Receive",
                        Resource: `arn:aws:iot:${config.region}:${config.accountId}:topic/republish/\${iot:ClientId}/*`
                    },
                    {
                        Effect: "Allow",
                        Action: "iot:Subscribe",
                        Resource: `arn:aws:iot:${config.region}:${config.accountId}:topicfilter/republish/\${iot:ClientId}/*`
                    },
                ]
            };
        const input = {
            policyName: iotPolicyName,
            policyDocument: JSON.stringify(policyDocument),
        };
        const command = new CreatePolicyCommand(input);
        return await client.send(command);
    }

    async createKeysAndCertificate() {
        console.log('[Device] Creating key and cert for ', this.thingName);

        const command = new CreateKeysAndCertificateCommand({setAsActive: true});
        const response = await client.send(command);
        return {
            certificate: response.certificatePem,
            certificateArn: response.certificateArn,
            certificateId: response.certificateId,
            key: response.keyPair.PrivateKey
        }
    }

    async attachPolicyToCertificate(certResponse) {
        console.log('[Device] Attaching policy to principal ', this.thingName);
        let result = await this.createIoTPolicy();
        console.log('[Device] Created iot policy ');

        const command = new AttachPolicyCommand({policyName: iotPolicyName, target: certResponse.certificateArn});
        return await client.send(command);
    }

    async attachCertificateToThing(certResponse) {
        console.log('[Device] Attaching cert to thing ', this.thingName);

        const command = new AttachThingPrincipalCommand({
            thingName: this.thingName,
            principal: certResponse.certificateArn
        });
        return await client.send(command);
    }

    async configureEndpoint() {
        const describeEndpointCommand = new DescribeEndpointCommand({
            endpointType: 'iot:Data-ATS'
        });
        const response = await client.send(describeEndpointCommand);
        return response.endpointAddress;
    }

    async cleanUp() {
        const principalsResponse = await client.send(new ListThingPrincipalsCommand({thingName: this.thingName}));
        const principals = principalsResponse?.principals;
        console.log('[CleanUp] Cleaning up resources for thing', {principals: principals});
        for (let j = 0; j < principals.length; j++) {
            console.log('[CleanUp] Detaching principal for thing', {
                thingName: this.thingName,
                principal: principals[j]
            });
            await client.send(new DetachThingPrincipalCommand({
                thingName: this.thingName,
                principal: principals[j]
            }));

            const detachPolicyResult = await client.send(new DetachPolicyCommand({
                policyName: iotPolicyName,
                target: principals[j]
            }))
            console.log('[CleanUp] Detached policy from principal', detachPolicyResult);
            console.log('[CleanUp] Deleting thing', {thingName: this.thingName});
            const deleteThingResult = await client.send(new DeleteThingCommand({thingName: this.thingName}));
            console.log('[CleanUp] Deleted thing', deleteThingResult);
        }
        return await client.send(new DeletePolicyCommand({policyName: iotPolicyName}));
    }
}
