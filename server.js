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
var logger_colors = { err: "\u001b[31m", info: "\x1b[37m", warn: "\x1b[33m", reset: "\u001b[0m" }
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
const FSE = require('fs-extra')
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
    // Helper
    getAllFilesStats(rootpath, path = "") {
        return new Promise((resolve, reject) => {
            FS.readdir(rootpath + path, (err, files) => {
                if (err) {
                    reject(err);
                }
                files = files || []
                var proms = [];
                for (let a = 0; a < files.length; a++) {
                    let childpath = path + "\\" + files[a];
                    let stat = FS.statSync(rootpath + childpath);
                    if (stat.isDirectory()) {
                        proms = proms.concat(this.getAllFilesStats(rootpath, childpath));
                    }
                    else {
                        stat.path = (childpath).replace(rootpath + PATH.sep, "").replaceAll("\\", "/");
                        delete stat.dev;
                        delete stat.mode;
                        delete stat.mode;
                        delete stat.uid;
                        delete stat.gid;
                        delete stat.rdev;
                        delete stat.blksize;
                        delete stat.ino;
                        delete stat.blocks;
                        delete stat.nlink;
                        delete stat.atime;
                        delete stat.mtime;
                        delete stat.ctime;
                        delete stat.birthtime;

                        proms.push(new Promise((resolve) => { resolve(stat) }));
                    }
                }
                Promise.allSettled(proms).then((results) => {
                    var resolved = [];
                    results.forEach(element => {
                        if (element.status == "fulfilled") {
                            resolved.push(element.value);
                        }
                    });
                    resolve(resolved.flat());
                });
            });
        });
    }

    getLatestFolder() {
        return new Promise((resolve, reject) => {
            var dataPath = [__dirname, "data"].join(PATH.sep);
            FS.readdir(dataPath, { withFileTypes: true }, (err, files) => {
                if (err) {
                    reject(err);
                }


                files = files.filter((file) => {
                    return file.isDirectory();
                });
                files = files.map((file) => {
                    var split1 = file.name.replace(".zip", "").split("+");
                    return { name: file.name, host: split1[0], date: new Date(split1[1].replace(/_/g, ":").replace(/,/g, ".")) };
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
                });
                resolve(files[0]);
            });
        });
    }

    // Doer
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
            logger("info", "Websocket", "Start");
            this.websocketserver.on('connection', (ws, req) => {
                logger("info", "Websocket", `Host ${this.activeHost.name} connected`);
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

                setInterval(() => {
                    ws.send(JSON.stringify({}));
                }, 1000);

                ws.on('close', (err) => {
                    logger("info", "Websocket", `Host ${this.activeHost.name} disconnected`);
                    this.incommingEvents.removeAllListeners("event");
                    //logger("info", "WSS", "ws Closed");
                });
                ws.on('error', (err) => {
                    logger("err", "Websocket", `Host ${this.activeHost.name} errored ${err}`);
                    this.incommingEvents.removeAllListeners("event");
                    //logger("err", "WSS", err);
                });
            });
            this.websocketserver.on("close", () => {
                this.incommingEvents.removeAllListeners("event");
                logger("err", "Websocket", `Closed`);
            });
            this.websocketserver.on("error", (err) => {
                this.incommingEvents.removeAllListeners("event");
                logger("err", "Websocket", `Error ${err}`);
            });
        }
        catch (err) {
            logger("err", "Websocket", `Error ${err}`);
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
            // get get File Stats
            this.webserver.get("/latest", (req, res) => {
                var authorization = req.headers.authorization;
                var host = this.hosts.find((host) => {
                    return host.authorization == authorization
                });
                if (host == undefined) {
                    res.status(401).send();
                    return;
                }

                this.getLatestFolder().then((latest) => {
                    res.status(200).send(latest.name);
                }, (err) => {
                    logger("info", "latest", `Error ${err}`);
                    res.status(500).send(err);
                });
            });
            // Create a new State
            this.webserver.get("/newlatest", (req, res) => {
                var authorization = req.headers.authorization;
                var host = this.hosts.find((host) => {
                    return host.authorization == authorization
                });
                if (host == undefined) {
                    res.status(401).send();
                    return;
                }
                let curdate = new Date(Date.now())
                var filename = `${host.name}+${(curdate.toISOString()).replace(/:/g, "_").replace(/\./g, ",")}`
                var targetPath = [__dirname, "data", filename].join(PATH.sep);
                this.getLatestFolder().then((latestFolder) => {
                    if (!latestFolder) {
                        FS.mkdir(targetPath, { recursive: true }, (err) => {
                            if (err) {
                                logger("err", "newlatest", `Create directory error ${targetPath} ${err}`)
                                res.status(500).send(err);
                                return;
                            }
                            logger("info", "newlatest", `New ${filename}`)
                            res.status(200).send(filename);
                        })

                    }
                    else {
                        if ((Date.now() - latestFolder.date.getTime() < 30000) && (host.name == latestFolder.host)) {
                            logger("info", "newlatest", `Old ${latestFolder.name}`)
                            res.status(200).send(latestFolder.name);
                            return;
                        }
                        var sourcePath = [__dirname, "data", latestFolder.name].join(PATH.sep);
                        FSE.copy(sourcePath, targetPath, (err) => {
                            if (err) {
                                logger("err", "newlatest", `Error copy from ${latestFolder.name} to ${filename} ${err}`)
                                res.status(500).send(err);
                                return;
                            }
                            logger("info", "newlatest", `New ${filename}`)
                            res.status(200).send(filename);
                        });
                    }
                });


            });
            // Upload a new File to state
            this.webserver.get("/data/:state", (req, res) => {
                var authorization = req.headers.authorization;
                var host = this.hosts.find((host) => {
                    return host.authorization == authorization
                });
                if (host == undefined) {
                    res.status(401).send();
                    return;
                }
                var folderpath = [__dirname, "data", req.params.state].join(PATH.sep);

                this.getAllFilesStats(folderpath).then((stats) => {
                    res.status(200).json(stats);
                }, (err) => {
                    res.status(500).send(err);
                });

            });
            // Get File
            this.webserver.get("/data/:state/*", (req, res) => {
                var authorization = req.headers.authorization;
                var host = this.hosts.find((host) => {
                    return host.authorization == authorization
                });
                if (host == undefined) {
                    res.status(401).send();
                    return;
                }

                var folderpath = [__dirname, "data", req.params.state].join(PATH.sep);
                var relpath = decodeURI(req.path).replace(/%23/g, "#").slice(("/data/" + req.params.state + "/").length).replace(/\//g, PATH.sep);
                var filepath = [folderpath, relpath].join(PATH.sep);
                //logger("info","GetStateFile", `Return File ${filepath}`)
                FS.readFile(filepath, (err, data) => {
                    if (err) {
                        logger("err", "GetStateFile", `Error read ${filepath} , ${err}`)
                        res.status(500).send(err);
                        return;
                    }
                    res.status(200).send(data);
                })
            });
            this.webserver.post("/data/:state/*", (req, res) => {
                var authorization = req.headers.authorization;
                var host = this.hosts.find((host) => {
                    return host.authorization == authorization
                });
                if (host == undefined) {
                    res.status(401).send();
                    return;
                }

                var folderpath = [__dirname, "data", req.params.state].join(PATH.sep);
                var relpath = decodeURI(req.path).replace(/%23/g, "#").slice(("/data/" + req.params.state + "/").length).replace(/\//g, PATH.sep);
                var filepath = [folderpath, relpath].join(PATH.sep);
                if (FS.existsSync(folderpath)) {
                    FS.writeFile(filepath, req.body, (err) => {
                        if (err) {
                            logger("err", "postStateFile", `Error copy from ${latestFolder.name} to ${filename} ${err}`)
                            res.status(500).send(err);
                            return;
                        }
                        res.status(200).send()
                    });
                }
                else {
                    logger("err", "postStateFile", `State not found "${req.params.state}"`)
                    res.status(404).send(`State not found "§${req.params.state}"`);
                    return;
                }


            });
            this.webserver.delete("/data/:state/*", (req, res) => {
                var authorization = req.headers.authorization;
                var host = this.hosts.find((host) => {
                    return host.authorization == authorization
                });
                if (host == undefined) {
                    res.status(401).send();
                    return;
                }

                var folderpath = [__dirname, "data", req.params.state].join(PATH.sep);
                var relpath = decodeURI(req.path).replace(/%23/g, "#").slice(("/data/" + req.params.state + "/").length).replace(/\//g, PATH.sep);
                var filepath = [folderpath, relpath].join(PATH.sep);
                if (FS.existsSync(folderpath)) {
                    FS.rm(filepath, (err) => {
                        if (err) {
                            logger("err", "newlatest", `Error copy from ${latestFolder.name} to ${filename} ${err}`)
                            res.status(500).send(err);
                            return;
                        }
                        res.status(200).send()
                    });
                }
                else {
                    logger("err", "newlatest", `State not found "${req.params.state}"`)
                    res.status(404).send(`State not found "§${req.params.state}"`);
                    return;
                }
                /*              
                                this.getLatestFolder().then((latestFolder) => {
                                    
                                    let curdate = new Date(Date.now())
                                    var filename = `${host.name}+${(curdate.toISOString()).replace(/:/g, "_").replace(/\./g, ",")}`
                                    var targetPath = [__dirname, "data", filename].join(PATH.sep);
                                    var sourcePath = [__dirname, "data", latestFolder.name].join(PATH.sep);
                
                                    FS.cp(sourcePath, targetPath, { recursive: true }, (err) => {
                                        if (err) {
                                            logger("err", "newlatest", `Error copy from ${latestFolder.name} to ${filename} ${err}`)
                                            res.status(500).send(err);
                                            return;
                                        }
                                        logger("info", "newlatest", `New ${filename}`)
                                        res.status(200).send(filename);
                                    });
                                });
                */

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
const { resolveObjectURL } = require('buffer');
class TcpServer {
    constructor(config, incommingEvents, outgoingEvents) {
        this.config = config;
        this.incommingEvents = incommingEvents;
        this.outgoingEvents = outgoingEvents;
        this.tcpserver = new Net.Server();
        this.connections = {};
    }
    setup() {
        this.tcpserver.on('connection', (socket) => {
            try {
                logger("info","TCP",`Connect\tConnections:${ Object.keys(this.connections).length} `)
                var connection = {};
                connection.ip = socket.remoteAddress;
                connection.port = socket.remotePort;
                connection.event = "connection";
                this.connections[socket.remoteAddress+socket.remotePort] = connection;
 
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
                            logger("info","TCP",`Closed\tConnections:${ Object.keys(this.connections).length} `)
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
                    logger("info","TCP",`Closed\tConnections:${ Object.keys(this.connections).length} `)
                    connection.message = "";
                    connection.event = "closed";
                    this.incommingEvents.emit("event", connection);
                    this.outgoingEvents.removeListener("event", event);
                    
                    delete this.connections[connection.ip+connection.port] 
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