import type { Socket } from "socket.io-client";
import { io } from "socket.io-client";
import type { PlayerConnect } from "./ConnectionInstance";
import type { InputManager } from "yage/inputs/InputManager";
import type { CoreConnectionInstanceOptions } from "./CoreConnectionInstance";
import { CoreConnectionInstance } from "./CoreConnectionInstance";
import { isEqual } from "lodash";

export type SocketIoMultiplayerInstanceOptions<T> = CoreConnectionInstanceOptions<T> & {
  address: string;
  host: string;
};

export const isSocketIoMultiplayerInstanceOptions = <T>(
  options?: CoreConnectionInstanceOptions<T>
): options is SocketIoMultiplayerInstanceOptions<T> => {
  return (
    (options as SocketIoMultiplayerInstanceOptions<T>)?.address !== undefined && (options as any)?.prefix === undefined
  );
};

export class SocketIoMultiplayerInstance<T> extends CoreConnectionInstance<T> {
  socket: Socket;
  connectionPromise: Promise<void>;
  private groupId: string;

  constructor(
    player: PlayerConnect<T>,
    inputManager: InputManager,
    protected options: SocketIoMultiplayerInstanceOptions<T>
  ) {
    super(player, inputManager, options);
    this.groupId = options.address;
    this.socket = io(this.options.host);
    this.connectionPromise = this.setupSocketHandlers();
  }

  private setupSocketHandlers(): Promise<void> {
    return new Promise((resolve) => {
      this.socket.on("connect", () => {
        console.log("Connected to server, joining group:", this.groupId);
        // Send both groupId and netId when joining
        this.socket.emit("joinGroup", this.groupId, this.player.netId);
      });

      this.socket.on("groupJoined", ({ groupId, rooms }) => {
        console.log("Joined group:", groupId, "Available rooms:", rooms);
        this.player.connected = true;
        this.player.connectionId = this.socket.id;
        this.player.connectionTime = Date.now();
        console.log(rooms.reduce((acc: any, room: any) => ({ ...acc, [room.roomId]: room }), {}));
        this.handleData([
          "server",
          "rooms",
          rooms.reduce((acc: any, room: any) => ({ ...acc, [room.roomId]: room }), {}),
        ]);
        this.roomSyncResolve();
        resolve();
      });

      this.socket.on("roomJoined", ({ roomId, messages }) => {
        console.log("Joined room:", roomId);
        messages.forEach((msg: any) => {
          this.handleData([msg.playerId, msg.event, ...msg.data]);
        });
      });

      this.socket.onAny((event, ...args) => {
        if (event !== "frame") {
          console.log(event, args);
        }
        if (!["connect", "disconnect", "groupJoined", "roomJoined"].includes(event)) {
          const playerid = args.shift();
          this.handleData([playerid, event, ...args]);
        }
      });

      this.socket.on("disconnect", () => {
        console.log("Disconnected from server");
        this.player.connected = false;
        this.player.connectionTime = 0;
        // if (this.player.currentRoomId) {
        //   super.leaveRoom(this.player.currentRoomId);
        // }
      });
    });
  }

  async connect(): Promise<void> {
    await super.connect();
    await this.connectionPromise;
  }

  emit(event: string, ...args: any[]) {
    this.socket.emit(event, ...args);
    if (event !== "message") {
      this.handleData([this.player.netId, event, ...args]);
    }
  }

  handleData(data: any) {
    const [playerId, event, ...args] = data;

    if (this.onceSubscriptions[event]) {
      this.onceSubscriptions[event].forEach((callback) => {
        callback(playerId, ...args);
      });
      this.onceSubscriptions[event] = [];
    }
    if (this.subscriptions[event]) {
      this.subscriptions[event].forEach((callback) => {
        callback(playerId, ...args);
      });
    }
  }

  leaveRoom(roomId: string, lastFrame: number, localPlayerIndex?: number): void {
    if (this.player.currentRoomId === roomId) {
      this.socket.emit("leaveRoom");
    }
    super.leaveRoom(roomId, lastFrame, localPlayerIndex);
  }
}
