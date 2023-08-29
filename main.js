"use strict";

import fastify from "fastify";
import ws from "@fastify/websocket";
import ViGEmClient from "vigemclient";
import protobuf from "protobufjs";
import wrtc from "wrtc";

const { RTCPeerConnection } = wrtc;

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
server.register(ws, { connectionOptions: { readableObjectMode: true } });

const handleUpdate = (controller, { button, axis }) => {
  if (button) {
    controller.button[button.name].setValue(button.pressed);
  }

  if (axis) {
    if (["left", "right"].includes(axis.name)) {
      controller.axis[`${axis.name}X`].setValue(axis.x);
      controller.axis[`${axis.name}Y`].setValue(axis.y);
    }
  }
};

const initWebRTC = () => {
  const servers = process.env.WEBMOTE_ICE_SERVERS?.split(",") ?? [];
  const peerConnection = new RTCPeerConnection({
    iceServers: servers.map((server) => ({ urls: server })),
  });

  peerConnection.onconnectionstatechange = () => {
    console.log("wRTC", peerConnection.connectionState);
  };

  return peerConnection;
};

server.register(async (server) => {
  server.get("/ws", { websocket: true }, (connection) => {
    /** @type {RTCPeerConnection} */
    let peerConnection;

    connection.socket.on("message", async (data) => {
      try {
        const message = JSON.parse(data);

        if (message.offer) {
          if (peerConnection) peerConnection.close();
          peerConnection = initWebRTC();

          peerConnection.ondatachannel = ({ channel }) => {
            const controller = client.createX360Controller();
            if (controller.connect()) {
              console.log(err);
              process.exit(1);
            }

            controllers.add(controller);

            channel.onmessage = ({ data }) => {
              console.log('got data')

              const message = Update.decode(new Uint8Array(data));
              const update = Update.toObject(message, {
                enums: String,
              });

              handleUpdate(controller, update);
            };

            channel.onclose = () => {
              controller.disconnect();
              controllers.delete(controller);
            };
          };

          peerConnection.onicecandidate = ({ candidate }) => {
            connection.socket.send(JSON.stringify({ ice: candidate }));
          };

          await peerConnection.setRemoteDescription(message.offer);
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          connection.socket.send(JSON.stringify({ answer }));
        }

        if (message.ice) {
          await peerConnection?.addIceCandidate(message.ice);
        }
      } catch (e) {
        console.error("failed trying to handle client message", e);
      }
    });

    connection.socket.on("close", () => {
      peerConnection?.close();
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
