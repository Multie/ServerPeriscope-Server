# ServerPeriscope-Server

This periscope allows you to host a web application on your local PC and still be accessible via a public server. In addition, the web application can be shared across multiple PCs.

## Installation
### Debian

1. Please install git, nodejs and npm on your system. https://nodejs.org
````sh
$ sudo apt update
$ sudo apt install nodejs npm
$ sudo apt install git

# Check your installation
$ node --version
-> v12.22.12
$ git --version
-> git version 2.30.2
````
2. Create a new user 
````sh
sudo adduser ServerPeriscope
````
3. Clone the Server reposetory on your server.
```` sh
git clone https://github.com/Multie/ServerPeriscope-Server
````
4. Setup your Server
```` sh
$ cd ServerPeriscope-Server
$ cd configs
$ cp config.examplejson config.json
$ cp hosts.examplejson hosts.json

````


