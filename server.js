/*
 *   Copyright (c) 2022 Malte Hering
 *   All rights reserved.

 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at

 *   http://www.apache.org/licenses/LICENSE-2.0

 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 */
/////////////////////////////////////////////////////////////////
//#region Logger
const readline = require('readline');
/*readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name === 'c') {
        process.exit();
    } 
    else if (key.name === 'i') {
        if (logger_input) { 
            loggerResume();
        }
        else {
            loggerStop();
            logger("info","Help","Select a number",true);
            logger("info","Help","[1] Logs",true);
        }
    }
});*/
var logger_names = [];
var logger_backlog = [];
var logger_input = false;
var logger_colors = { err: "\u001b[31m", info: "\x1b[37m", warn: "\x1b[33m", reset:"\u001b[0m"}
function logger(type, name, text, force = false) {
    if (!logger_names.includes(name)) {
        logger_names.push(name);
    }
    if (!logger_input || force) {
        var color = logger_colors[type];
        if (!color) {
            color = "";
        }
        if (typeof (text) == "string") {
            console.log(`${color}[${name}]:${text}\u001b[0m`);
        }
        else if (typeof (text) == "object") {
            process.stdout.write(`${color}[${name}]:\u001b[0m`);
            console.log(text);
            //process.stdout.write("\u001b[0m");
        }
    }
    else {
        logger_backlog.push({ type: type, name: name, text: text });
    }
}
function loggerStop() {
    logger_input = true;
}
function loggerResume() {
    logger_input = false;
    while (logger_backlog.length > 0) {
        var log = logger_backlog.shift();
        logger(log.type, log.name, log.text);
    }
}
//#endregion
/////////////////////////////////////////////////////////////////
//#region EventEmitter
var EventEmitter;
try {
    EventEmitter = require("node:events")
    // do stuff
} catch (ex) {
    EventEmitter = require("events");
}
class MyEmitter extends EventEmitter { }
const incommingEvents = new MyEmitter();
const outgoingEvents = new MyEmitter();
//#endregion
/////////////////////////////////////////////////////////////////
//#region Config
const PATH = require("path");
const FS = require("fs");
const { resolve } = require("path");
function readConfig(path) {
    if (FS.existsSync(path)) {
        var filebuffer = FS.readFileSync(path);
        return JSON.parse(filebuffer);
    }
    return {};
}
var config = readConfig(`${__dirname}${PATH.sep}configs${PATH.sep}config.json`);
var hosts = readConfig(`${__dirname}${PATH.sep}configs${PATH.sep}hosts.json`);
var clients = readConfig(`${__dirname}${PATH.sep}configs${PATH.sep}clients.json`);
//#endregion
/////////////////////////////////////////////////////////////////
//#region WebServer
const express = require('express');
const bodyParser = require("body-parser");
const ws = require("ws");
const WebSocketServer = ws.WebSocketServer;
class WebServer {

    constructor(config, hosts, clients, incommingEvents, outgoingEvents) {
        this.config = config;
        this.hosts = hosts;
        this.clients = clients;
        this.activeHost = null;

        this.webserver = express();
        this.server = null;
        this.webserver.use(bodyParser.text())

        this.websocketserver = null;

        this.incommingEvents = incommingEvents;
        this.outgoingEvents = outgoingEvents;
    }

    disconnectWebsocketClients() {
        return new Promise((resolve, reject) => {
            if (this.websocketserver) {
                for (var a = 0; a < this.websocketserver.clients.length; a++) {
                    this.websocketserver.clients[a].close();
                }
                setTimeout(() => {
                    if (this.websocketserver) {
                        for (var a = 0; a < this.websocketserver.clients.length; a++) {
                            if ([this.websocketserver.clients[a].OPEN, this.websocketserver.clients[a].CLOSING].includes(this.websocketserver.clients[a].readyState)) {
                                this.websocketserver.clients[a].terminate();
                            }
                        }
                    }
                    resolve();
                }, 1000);
            }
            else {
                resolve();
            }
        })


    }
    startWebsocket() {
        try {

            this.websocketserver = new WebSocketServer({ noServer: true });
            logger("info","Websocket","Start");
            this.websocketserver.on('connection', (ws, req) => {
                logger("info","Websocket",`Host ${this.activeHost.name} connected`);
                //logger("info", "WSS", "Connected");
                ws.on('message', (text) => {
                    let data = JSON.parse(text);
                    outgoingEvents.emit("event", data);
                });
                let sendData = (data) => {
                    //logger("info","WSS",(data));
                    ws.send(JSON.stringify(data));
                }
                this.incommingEvents.on("event", sendData);
                ws.on('pong', () => {

                });

                ws.on('close', (err) => {
                    logger("info","Websocket",`Host ${this.activeHost.name} disconnected`);
                    this.incommingEvents.removeAllListeners("event");
                    //logger("info", "WSS", "ws Closed");
                });
                ws.on('error', (err) => {
                    logger("err","Websocket",`Host ${this.activeHost.name} errored ${err}`);
                    this.incommingEvents.removeAllListeners("event");
                    //logger("err", "WSS", err);
                });
            });
            this.websocketserver.on("close", () => {
                this.incommingEvents.removeAllListeners("event");
                logger("err","Websocket",`Closed`);
            });
            this.websocketserver.on("error", (err) => {
                this.incommingEvents.removeAllListeners("event");
                logger("err","Websocket",`Error ${err}`);
            });
        }
        catch (err) {
            logger("err","Websocket",`Error ${err}`);
        }
    }
    setup() {
        return new Promise((resolve, reject) => {
            this.webserver.use(bodyParser.text({
                type: "plain/text"
            }));
            this.webserver.use(bodyParser.json({
                type: "application/json"
            }));
            this.webserver.use(bodyParser.raw({
                type: "application/octet-stream",
                limit: '100000mb'
            }));

            // Download latest File
            this.webserver.get("/data", (req, res) => {
                var authorization = req.headers.authorization;
                var host = this.hosts.find((host) => {
                    return host.authorization == authorization
                });
                if (host == undefined) {
                    res.status(401).send("host not found");
                    return;
                }
                var dataPath = `${__dirname}${PATH.sep}data`

                FS.mkdir(PATH.dirname(dataPath), { recursive: true }, (err) => {
                    if (err) {
                        console.trace(err);
                        res.status(400).send(err);
                        return;
                    }
                    FS.readdir(dataPath, { withFileTypes: true }, (err, files) => {
                        if (err) {
                            console.trace(err);
                            res.status(400).send(err);
                            return;
                        }
                        files = files.filter((file) => {
                            return file.isFile();
                        })
                        files = files.map((file) => {
                            var split1 = file.name.replace(".zip", "").split("#");
                            return { name: file.name, host: split1[0], date: new Date(split1[1].replaceAll("_", ":").replaceAll(",", ".")) };
                        });

                        files.sort((a, b) => {
                            if (a.date < b.date) {
                                return 1;
                            }
                            else if (a.date > b.date) {
                                return -1;
                            }
                            else {
                                return 0;
                            }
                        })

                        FS.readFile(dataPath + PATH.sep + files[0].name, { encoding: null }, (err, data) => {
                            if (err) {
                                console.trace(err);
                                res.status(400).send(err);
                                return;
                            }
                            res.send(data);
                        });
                    })
                });
            });
            // Upload File 
            this.webserver.post("/data", (req, res) => {
                var data = req.body;
                var authorization = req.headers.authorization;
                var host = this.hosts.find((host) => {
                    return host.authorization == authorization
                });
                if (host == undefined) {
                    res.status(401).send();
                    return;
                }
                let curdate = new Date(Date.now())
                var filename = `${host.name}#${(curdate.toISOString()).replaceAll(":", "_").replaceAll(".", ",")}.zip`
                var filepath = `${__dirname}${PATH.sep}data${PATH.sep}${filename}`;
                FS.mkdir(PATH.dirname(dataPath), { recursive: true }, (err) => {
                    if (err) {
                        console.trace(err);
                        res.status(400).send(err);
                        return;
                    }
                    FS.writeFile(filepath, data, (err) => {
                        if (err) {
                            console.trace(err);
                            res.status(400).send(err);
                            return;
                        }
                        logger("Webserver", `Uploaded new Service ${filename}`);
                        res.status(200).send();
                    });
                });
            });
            // become host
            this.webserver.get("/host", (req, res) => {
                var authorization = req.headers.authorization;
                var host = this.hosts.find((host) => {
                    return host.authorization == authorization
                });
                if (host == undefined) {
                    res.status(401).send();
                    return;
                }
                res.status(200).send(true);
                this.disconnectWebsocketClients().then(() => {
                    host.ip = req.ip;
                    this.activeHost = host;
                    logger("info", "Webserver", "Set new host:" + host.name)
                });
            });
            resolve();
        });
    }
    start() {
        this.startWebsocket();
        this.server = this.webserver.listen(config.websocketPort, () => {
            console.log(`Example app listening on port ${config.websocketPort}`)
        });
        this.server.on('upgrade', (request, socket, head) => {

            if (!this.activeHost) {
                socket.destroy();
                return;
            }
            if (this.activeHost.ip != request.ip) {
                socket.destroy();
                return;
            }

            
            this.websocketserver.handleUpgrade(request, socket, head, socket => {
                this.websocketserver.emit('connection', socket, request);
            });
        });
    }
}

var WebServerClient = new WebServer(config, hosts, clients, incommingEvents, outgoingEvents);
WebServerClient.setup().then(() => {
    WebServerClient.start();
});
//#endregion
/////////////////////////////////////////////////////////////////
//#region TCP Server
const Net = require('net');
class TcpServer {
    constructor(config, incommingEvents, outgoingEvents) {
        this.config = config;
        this.incommingEvents = incommingEvents;
        this.outgoingEvents = outgoingEvents;
        this.tcpserver = new Net.Server();
        this.connections = [];
    }
    setup() {
        this.tcpserver.on('connection', (socket) => {
            try {
                // Limit Maximale Verbindungen gleichzeitig
                var cons = this.connections.filter((val) => {
                    return val.ip == socket.remoteAddress;
                })
                if (cons.length > 5) {
                    socket.destroy();
                    return;
                }
                var connection = {};
                connection.ip = socket.remoteAddress;
                connection.port = socket.remotePort;
                connection.event = "connection";
                this.connections.push(connection);
                this.incommingEvents.emit("event", connection);

                var event = ((data) => {
                    if (!data) {
                        return;
                    }
                    if (connection.ip == data.ip && connection.id == data.id && connection.port == data.port) {
                        if (data.event == "message") {
                            let buf = new Buffer.from(Uint8Array.from(data.data));
                            socket.write(buf);
                        }
                        else if (data.event == "closed") {
                            socket.destroy();
                        }
                    }
                });
                this.outgoingEvents.on("event", event);
                socket.on('data', (chunk) => {
                    if (chunk.length > 0) {
                        connection.data = new Array(chunk.length);
                        for (let i = 0; i < chunk.length; i = i + 1)
                            connection.data[i] = chunk[i];
                    }
                    else {
                        connection.data = [];
                    }
                    connection.event = "message";
                    this.incommingEvents.emit("event", connection);
                });
                socket.on('end', () => {
                    connection.message = "";
                    connection.event = "closed";
                    this.incommingEvents.emit("event", connection);
                    this.outgoingEvents.removeListener("event", event);
                    var index = this.connections.indexOf(connection);
                    this.connections.splice(index, 1);
                });

            }
            catch (err) {
                logger("err", "TCP", err);
            }
        });
        this.tcpserver.on("error", (err) => {
            this.outgoingEvents.removeAllListeners("event");
            logger("err", "TCP", err);
        });
    }
    start() {
        this.tcpserver.listen(this.config.recievePort, () => {
            console.log(`Server listen on ${this.config.recievePort}`);
        });
    }
}

var TcpServerInstance = new TcpServer(config, incommingEvents, outgoingEvents);
TcpServerInstance.setup();
TcpServerInstance.start();
//#endregion