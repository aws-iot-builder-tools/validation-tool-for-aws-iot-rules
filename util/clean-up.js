import {
    IoTClient,
    ListThingsCommand, DetachThingPrincipalCommand, ListThingPrincipalsCommand, DeleteThingCommand
} from "@aws-sdk/client-iot";
import {logger} from "../app/log/logger.js";
import {config} from "../util/config.js";

const client = new IoTClient({region: config.region});

//If you have many things, you need to either implement the nextToken feature here, or run the script more than once.
//Note that there are TPS limits with AWS IoT Core APIs.
const cleanUp = async () => {
    const command = new ListThingsCommand({});
    const response = await client.send(command);
    const things = response.things;
    logger.info('[CleanUp] Things', {things: things});

    if (things && things.length>0) {
        for (let index = 0; index < things.length; index++) {
            const thingName = things[index].thingName;
            if(thingName.startsWith('sim-')) {
                logger.info('[CleanUp] Cleaning up resources for thing', {thingName: thingName});
                const principalsResponse = await client.send(new ListThingPrincipalsCommand({thingName: thingName}));
                const principals = principalsResponse?.principals;
                logger.info('[CleanUp] Cleaning up resources for thing', {principals: principals});

                for (let j = 0; j < principals.length; j++) {
                    logger.info('[CleanUp] Detaching principal for thing', {
                        thingName: thingName,
                        principal: principals[j]
                    });
                    await client.send(new DetachThingPrincipalCommand({
                        thingName: thingName,
                        principal: principals[j]
                    }));
                    logger.info('[CleanUp] Deleting thing', {thingName: thingName});
                    await client.send(new DeleteThingCommand({thingName: thingName}));
                }
            }
        }
    }
}
await cleanUp().then(()=> {
    logger.info('[CleanUp] Done.');
});

