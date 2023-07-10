import {
    IoTClient,
    CreateTopicRuleCommand,
    DeleteTopicRuleCommand
} from "@aws-sdk/client-iot";
import {
    CreateRoleCommand,
    IAMClient,
    AttachRolePolicyCommand,
    CreatePolicyCommand,
    DeleteRoleCommand, DetachRolePolicyCommand, DeletePolicyCommand
} from "@aws-sdk/client-iam";

import {config} from "../util/config.js";

const client = new IoTClient({region: config.region});
const client_iam = new IAMClient({region: config.region});

let roleName = "iot_r_";
const policyName = "iot_pol_";

//TODO: All the resource creation calls should be made idempotent.
const createRole = async () => {
    const generateRandomString = (length = 6) => Math.random().toString(20).substr(2, length)
    const command = new CreateRoleCommand(
        {
            AssumeRolePolicyDocument: JSON.stringify({
                Version: "2012-10-17",
                Statement: [
                    {
                        Effect: "Allow",
                        Principal: {
                            Service: "iot.amazonaws.com",
                        },
                        Action: "sts:AssumeRole",
                    },
                ],
            }),
            RoleName: roleName + generateRandomString()
        });

    const result = await client_iam.send(command);
    return result.Role;
}
const createPolicy = async () => {
    const generateRandomString = (length = 6) => Math.random().toString(20).substr(2, length)

    const command = new CreatePolicyCommand({
        PolicyDocument: JSON.stringify({
            Version: "2012-10-17",
            Statement:
                {
                    Effect: "Allow",
                    Action: "iot:Publish",
                    Resource: `arn:aws:iot:${config.region}:${config.accountId}:topic/*`
                }
        }),
        PolicyName: policyName + generateRandomString(),
    });
    const result = await client_iam.send(command);
    return result.Policy;
};

const attachRolePolicy = async (policyArn, roleName) => {
    const command = new AttachRolePolicyCommand({
        PolicyArn: policyArn,
        RoleName: roleName,
    });
    const result = await client_iam.send(command);
    return (result.$metadata.httpStatusCode === 200);
};

export const setUpRoleAndPolicy = async () => {
    const role = await createRole();
    const policy = await createPolicy();
    const res = await attachRolePolicy(policy.Arn, role.RoleName);
    return res? {
        policyArn: policy.Arn,
        roleArn: role.Arn,
        roleName: role.RoleName

    } : {};
}

export const tearDownRoleAndPolicy = async (policyArn, roleName) => {
    await detachRolePolicy(policyArn, roleName);
    await deleteIAMRole(roleName);
    try {
        const response =  await deleteIAMPolicy(policyArn);
        return (response.$metadata.httpStatusCode === 200);
    } catch (e) {
        return false;
    }
}

export const tearDownRule = async (ruleName) => {
    return await deleteTopicRule(ruleName);
}

export const createTopicRule = async (sqlUnderTest, sqlVersion, ruleName, topic, roleArn) => {
    const input = {
        ruleName: ruleName,
        topicRulePayload: {
            sql: sqlUnderTest,
            awsIotSqlVersion: sqlVersion ,
            description: ruleName,
            actions: [
                {
                    republish: {
                        roleArn: roleArn,
                        topic: topic,
                        qos: Number("1")
                    },
                }
            ]
        }
    };
    const command = new CreateTopicRuleCommand(input);
    try {
        const response =  await client.send(command);
        return (response.$metadata.httpStatusCode === 200);
    } catch (e) {
        return false;
    }
    //TODO: parse errors.
}

const deleteTopicRule = async (ruleName) => {
    const input = {
        ruleName: ruleName,
    };
    const command = new DeleteTopicRuleCommand(input);
    try {
        const response =  await client.send(command);
        return (response.$metadata.httpStatusCode === 200);
    } catch (e) {
        return false;
    }
}

const deleteIAMRole = async (roleName) => {
    const input = {
        RoleName: roleName,
    };
    const command = new DeleteRoleCommand(input);
    return await client_iam.send(command);
}

const deleteIAMPolicy = async (policyArn) => {
    const input = {
        PolicyArn: policyArn,
    };
    const command = new DeletePolicyCommand(input);
    return await client_iam.send(command);
}

const detachRolePolicy = async (policyArn, roleName) => {
    const command = new DetachRolePolicyCommand({
        PolicyArn: policyArn,
        RoleName: roleName,
    });

    return await client_iam.send(command);
};
