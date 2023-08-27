"use strict";

import fastify from "fastify";
import ws from "@fastify/websocket";

import ViGEmClient from "vigemclient";

let client = new ViGEmClient();
/** @type {Set<import("vigemclient/lib/X360Controller").X360Controller>} */
const controllers = new Set();

const connErr = client.connect();
if (connErr !== null) {
  console.error(connErr);
  process.exit(1);
}

const server = fastify();
server.register(ws);

server.register(async (server) => {
  server.get("/ws", { websocket: true }, (connection) => {
    let controller = client.createX360Controller();

    let err = controller.connect();

    if (err) {
      connection.socket.send(
        JSON.stringify({
          type: "error",
          message: err.message,
        })
      );
      process.exit(1);
    }

    controllers.add(controller);

    connection.socket.on("message", (message) => {
      let { type, name, value } = JSON.parse(message);

      console.log({ type, name, value });

      if (type === "button") {
        controller.button[name.toUpperCase()].setValue(value);
      } else if (type === "axis") {
        const [x, y] = value;
        if (["left", "right"].includes(name)) {
          controller.axis[`${name}X`].setValue(x);
          controller.axis[`${name}Y`].setValue(y);
        }
      }
    });

    connection.socket.on("close", () => {
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

server.listen({ port: 8080 }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening at ${address}`);
});
