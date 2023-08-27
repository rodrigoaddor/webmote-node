"use strict";

import fastify from "fastify";
import ws from "@fastify/websocket";
import ViGEmClient from "vigemclient";
import protobuf from "protobufjs";

const messages = await protobuf.load("./data/messages.proto");
const Update = messages.lookupType("webmote.Update");

let client = new ViGEmClient();
/** @type {Set<import("vigemclient/lib/X360Controller").X360Controller>} */
const controllers = new Set();

const connErr = client.connect();
if (connErr !== null) {
  console.error(connErr);
  process.exit(1);
}

const server = fastify();
server.register(ws, {connectionOptions: {readableObjectMode: true}});

server.register(async (server) => {
  server.get("/ws", { websocket: true }, (connection) => {
    connection.socket.binaryType = "arraybuffer";

    let controller = client.createX360Controller();

    let err = controller.connect();

    if (err) {
      console.log(err)
      process.exit(1);
    }

    controllers.add(controller);

    connection.socket.on("message", (data) => {
      const message = Update.decode(new Uint8Array(data));
      const { button, axis } = Update.toObject(message, {enums: String});

      if (button) {
        controller.button[button.name].setValue(button.pressed);
      }

      if (axis) {
        if (["left", "right"].includes(axis.name)) {
          controller.axis[`${axis.name}X`].setValue(axis.x);
          controller.axis[`${axis.name}Y`].setValue(axis.y);
        }
      }
    });

    connection.socket.on("close", (a, b) => {
      controller.disconnect();
      controllers.delete(controller);
    });
  });
});

server.get("/", async (request, reply) => {
  return {
    controllers: [...controllers].map((controller) => ({
      index: controller.index,
      userIndex: controller.userIndex,
      attached: controller.attached,
      type: controller.type,
      axis: Object.keys(controller.axis).reduce((obj, name) => {
        obj[name] = controller.axis[name].value;
        return obj;
      }, {}),
      button: Object.keys(controller.button).reduce((obj, name) => {
        obj[name] = controller.button[name].value;
        return obj;
      }, {}),
    })),
  };
});

server.listen({ port: 8080, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening at ${address}`);
});
