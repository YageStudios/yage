import { Server } from "socket.io";
import { createServer } from "http";
import express from "express";

interface Message {
  event: string;
  data: any[];
  timestamp: number;
  sequence: number;
}

interface Room {
  id: string;
  messages: Message[];
  clients: Set<string>;
  lastSequence: number;
}

interface Group {
  id: string;
  rooms: Map<string, Room>;
  clients: Set<string>;
}

class SocketIoGameServer {
  private io: Server;
  private groups: Map<string, Group> = new Map();
  private clientGroups: Map<string, string> = new Map();
  private clientRooms: Map<string, string> = new Map();
  private messageCounter: number = 0;
  private clientNetIds: Map<string, string> = new Map(); // Maps socket.id to player netId
  private clientLastFrame: Map<string, number> = new Map(); // Maps socket.id to last frame

  constructor(port: number = 3001) {
    const app = express();
    const httpServer = createServer(app);

    // Setup REST endpoints
    const wrapHtml = (content: string, breadcrumbs: Array<[string, string]>) => {
      const links = breadcrumbs
        .map(([text, href], index) => `<a href="${href}">${text}</a>${index < breadcrumbs.length - 1 ? " &gt; " : ""}`)
        .join("");

      return `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Game Server Status</title>
            <style>
              body { font-family: system-ui, sans-serif; margin: 20px; }
              pre { background: #f5f5f5; padding: 15px; border-radius: 5px; }
              .nav { margin-bottom: 20px; }
              a { color: #0066cc; text-decoration: none; }
              a:hover { text-decoration: underline; }
              .breadcrumbs { margin-bottom: 15px; }
            </style>
          </head>
          <body>
            <div class="breadcrumbs">${links}</div>
            <pre>${content}</pre>
          </body>
        </html>`;
    };

    app.get("/status", (req, res) => {
      const status = this.getServerStatus();
      const html = wrapHtml(status, [["Server Status", "/status"]]);
      res.send(html);
    });

    app.get("/group/:groupId", (req, res) => {
      const groupStatus = this.getGroupStatus(req.params.groupId);
      if (!groupStatus) {
        res.status(404).send("Group not found");
        return;
      }
      const html = wrapHtml(groupStatus, [
        ["Server Status", "/status"],
        [`Group: ${req.params.groupId}`, `/group/${req.params.groupId}`],
      ]);
      res.send(html);
    });

    app.get("/group/:groupId/room/:roomId", (req, res) => {
      const roomStatus = this.getRoomStatus(req.params.groupId, req.params.roomId);
      if (!roomStatus) {
        res.status(404).send("Room not found");
        return;
      }
      const html = wrapHtml(roomStatus, [
        ["Server Status", "/status"],
        [`Group: ${req.params.groupId}`, `/group/${req.params.groupId}`],
        [`Room: ${req.params.roomId}`, `/group/${req.params.groupId}/room/${req.params.roomId}`],
      ]);
      res.send(html);
    });

    this.io = new Server(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });

    this.setupSocketHandlers();
    httpServer.listen(port);
    console.log(`Game server listening on port ${port}`);
  }

  private setupSocketHandlers() {
    this.io.on("connection", (socket) => {
      console.log(`Client connected: ${socket.id}`);

      // Add requestState handler
      socket.on("requestState", (roomId: string, playerConfig: string) => {
        const groupId = this.clientGroups.get(socket.id);
        console.log("requesting state", groupId, roomId, playerConfig);
        if (!groupId) {
          console.error("Client tried to request state without being in a group");
          return;
        }

        const group = this.groups.get(groupId);
        if (!group) {
          console.error("Invalid group for state request");
          return;
        }

        const room = group.rooms.get(roomId);
        if (!room) {
          console.error("Room not found for state request:", roomId);
          return;
        }

        const netId = this.clientNetIds.get(socket.id);
        if (!netId) {
          console.error("Client tried to request state without valid netId");
          return;
        }

        // Forward the state request to the room with the validated netId
        socket.to(`${groupId}:${roomId}`).emit("requestState", netId, roomId, playerConfig);
      });

      // Join group
      socket.on("joinGroup", (groupId: string, netId: string) => {
        console.log(`Client ${socket.id} joining group ${groupId} with netId ${netId}`);
        this.clientNetIds.set(socket.id, netId); // Store the netId
        this.handleJoinGroup(socket, groupId);
      });

      // Leave group
      socket.on("leaveGroup", () => {
        this.handleLeaveGroup(socket);
        this.clientNetIds.delete(socket.id);
      });

      // Join room within group
      socket.on("joinRoom", (roomId: string) => {
        console.log(`Client ${socket.id} joining room ${roomId}`);
        this.handleJoinRoom(socket, roomId);
      });

      // Leave room
      socket.on("leaveRoom", () => {
        this.handleLeaveRoom(socket);
      });

      // Handle all other messages
      socket.onAny((event, ...args) => {
        if (event !== "frame") {
          console.log(event, args);
        } else {
          this.clientLastFrame.set(socket.id, args[0].frame);
        }
        if (["joinGroup", "leaveGroup", "joinRoom", "leaveRoom"].includes(event)) return;
        this.handleMessage(socket, event, args);
      });

      socket.on("disconnect", () => {
        this.handleDisconnect(socket);
      });
    });
  }

  private handleJoinGroup(socket: any, groupId: string) {
    // Create group if it doesn't exist
    if (!this.groups.has(groupId)) {
      this.groups.set(groupId, {
        id: groupId,
        rooms: new Map(),
        clients: new Set(),
      });
    }

    const group = this.groups.get(groupId)!;
    group.clients.add(socket.id);
    this.clientGroups.set(socket.id, groupId);

    // Send room list to client
    const rooms = Array.from(group.rooms.keys()).map((roomId) => ({
      roomId,
      host: group.rooms.get(roomId)!.clients.values().next().value,
      players: Array.from(group.rooms.get(roomId)!.clients).map((clientId) => this.clientNetIds.get(clientId)),
      rebalanceOnLeave: false,
    }));
    socket.emit("groupJoined", { groupId, rooms });
  }

  private handleLeaveGroup(socket: any) {
    const groupId = this.clientGroups.get(socket.id);
    if (!groupId) return;

    // Leave any room first
    this.handleLeaveRoom(socket);

    const group = this.groups.get(groupId)!;
    group.clients.delete(socket.id);
    this.clientGroups.delete(socket.id);

    // Clean up empty group
    if (group.clients.size === 0) {
      this.groups.delete(groupId);
    }
  }

  private handleJoinRoom(socket: any, roomId: string) {
    const groupId = this.clientGroups.get(socket.id);
    if (!groupId) return;

    const group = this.groups.get(groupId)!;

    // Create room if it doesn't exist
    if (!group.rooms.has(roomId)) {
      group.rooms.set(roomId, {
        id: roomId,
        messages: [],
        clients: new Set(),
        lastSequence: 0,
      });
    }

    const room = group.rooms.get(roomId)!;
    room.clients.add(socket.id);
    this.clientRooms.set(socket.id, roomId);

    // Join socket.io room
    socket.join(`${groupId}:${roomId}`);

    this.handleMessage(socket, "joinRoom", [roomId]);

    // Send message history
    socket.emit("roomJoined", {
      roomId,
      messages: [],
    });
  }

  private handleLeaveRoom(socket: any) {
    const groupId = this.clientGroups.get(socket.id);
    const roomId = this.clientRooms.get(socket.id);
    if (!groupId || !roomId) return;

    const group = this.groups.get(groupId)!;
    const room = group.rooms.get(roomId)!;
    const netId = this.clientNetIds.get(socket.id);

    room.clients.delete(socket.id);
    this.clientRooms.delete(socket.id);
    socket.leave(`${groupId}:${roomId}`);
    socket.to(`${groupId}:${roomId}`).emit("leaveRoom", netId, roomId, this.clientLastFrame.get(socket.id));

    // Clean up empty room
    if (room.clients.size === 0) {
      group.rooms.delete(roomId);
    }
  }

  private handleMessage(socket: any, event: string, args: any[]) {
    const groupId = this.clientGroups.get(socket.id);
    const roomId = this.clientRooms.get(socket.id);
    if (!groupId || !roomId) return;

    const group = this.groups.get(groupId)!;
    const room = group.rooms.get(roomId)!;
    const netId = this.clientNetIds.get(socket.id);

    if (!netId) {
      console.error("Client tried to send message without valid netId");
      return;
    }

    // Create message
    const message: Message = {
      event,
      data: args,
      timestamp: Date.now(),
      sequence: ++this.messageCounter,
    };

    // Store message
    room.messages.push(message);
    room.lastSequence = message.sequence;

    // Relay to room with the stored netId prepended
    socket.to(`${groupId}:${roomId}`).emit(event, netId, ...args);
  }

  private handleDisconnect(socket: any) {
    this.handleLeaveGroup(socket);
    this.clientNetIds.delete(socket.id);
    console.log(`Client disconnected: ${socket.id}`);
  }

  // Status reporting methods
  private getServerStatus(): string {
    const groups = Array.from(this.groups.entries())
      .map(([id, group]) => {
        const rooms = Array.from(group.rooms.keys());
        return `  ${id}:
    clients: ${group.clients.size}
    rooms: ${group.rooms.size}
    active_rooms:
${rooms.map((room) => `      - ${room} -> /group/${id}/room/${room}`).join("\n")}`;
      })
      .join("\n");

    return `groups:\n${groups}`;
  }

  private getGroupStatus(groupId: string): string | null {
    const group = this.groups.get(groupId);
    if (!group) return null;

    const clients = Array.from(group.clients);
    const rooms = Array.from(group.rooms.entries())
      .map(
        ([id, room]) => `  ${id}:
    clients: ${room.clients.size}
    messages: ${room.messages.length}
    sequence: ${room.lastSequence}`
      )
      .join("\n");

    return `group: ${groupId}
clients: ${group.clients.size}
connected_clients:
${clients.map((client) => `  - ${client}`).join("\n")}
rooms:
${rooms}`;
  }

  private getRoomStatus(groupId: string, roomId: string): string | null {
    const group = this.groups.get(groupId);
    if (!group) return null;

    const room = group.rooms.get(roomId);
    if (!room) return null;

    const clients = Array.from(room.clients);
    const recentMessages = room.messages
      .slice(-10)
      .map(
        (msg) => `  - sequence: ${msg.sequence}
    event: ${msg.event}
    time: ${new Date(msg.timestamp).toISOString()}`
      )
      .join("\n");

    return `room: ${roomId}
group: ${groupId}
clients: ${room.clients.size}
connected_clients:
${clients.map((client) => `  - ${client}`).join("\n")}
messages: ${room.messages.length}
sequence: ${room.lastSequence}
recent_messages:
${recentMessages}`;
  }
}

export default SocketIoGameServer;
