const dotenv = require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
//const io = new Server(server);
const path = require('path');
const dateFormat = require("dateformat");
const bunyan = require('bunyan');
const cors = require('cors');

var virtualDirPath = "";

if (process.env.NODE_ENV === 'production') {
  virtualDirPath = process.env.virtualDirPath + '/socket.io';
}

app.use(express.static(path.join(virtualDirPath, 'public')));
app.use(cors());


var datetime = dateFormat(new Date(), "dd-mm-yyyy");
var log = bunyan.createLogger({
  name: 'serverjs',
  streams: [{
    type: 'rotating-file',
    path: process.env.logPath + datetime + '.log',
    period: '1d',   
    count: 10        
  }]
});

log.error(`virtual path is:  ${virtualDirPath}`);


var drivers = new Object();

var vendors = new Object();

var messagePool = [];

const io = require('socket.io')(server, { 	path: virtualDirPath , origins: '*:*' });



io.on('connection', (socket) => {
  console.log('a user connected');
  try {
 
    var TypeId = socket.handshake.query['TypeId'];
	var TypeName = socket.handshake.query['TypeName'];
		
    if (TypeName == "Driver") 
	{	
		log.info(`SocketId ${socket.id} connected`);
		drivers[TypeId] = { "socket": socket, "sid": socket.id, "driverId": TypeId };
		log.info(`Driver ${TypeId} connected`);
		
		  for (var i = 0; i < messagePool.length; i++) 
		  {
			if (messagePool[i].driverId == TypeId && (Date.now() - messagePool[i].time) < 60000) 
			{
			  drivers[TypeId].socket.emit('ServerResponse', { 'Method': messagePool[i].method, 'Data': messagePool[i].data });
			  messagePool.splice(i, 1);
			}
			else if ((Date.now() - messagePool[i].time) > 60000) 
			{
				log.info(`Remove Job by Connection > DriverId: ${messagePool[i].driverId} `);
				messagePool.splice(i, 1);
			    log.info(`Connection Pool After Check > ${JSON.stringify(messagePool)}`);
			}
		}
    }
	
	else if (TypeName == "Vendor")
	{
      vendors[TypeId] = { "socket": socket, "sid": socket.id, "vendorId": TypeId };
      log.info(`Vendor ${TypeId} connected`);

      
      for (var i = 0; i < messagePool.length; i++) 
	  {
        if (messagePool[i].vendorId == TypeId) 
		{
          vendors[TypeId].socket.emit('ServerResponse', { 'Method': messagePool[i].method, 'Data': messagePool[i].data });
          messagePool.splice(i, 1);
        }
      }
    }

    log.info(`connection > Total drivers: ${Object.keys(drivers).length} `);
	log.info(`connection > Total vendors: ${Object.keys(vendors).length} `);

  }
  catch (err) 
  {
    log.error(`connection > ${err.message}`);
  }

  socket.on('pingRequest', (msg) => {
    console.log('message: ' + msg);
    socket.emit('pingResponse', { 'date_time': new Date().toLocaleString() });
  });

  socket.on("connect_error", (msg) => {
    console.log(`connect_error due to ${msg.message}`);
  });

  socket.on('disconnect', function (msg)
  {
    try {
      if (socket && drivers)
	  {
        for (const [key, value] of Object.entries(drivers)) {
          if (value && value.sid == socket.id) {
            
            delete drivers[key];
			log.info(`disconnect > Driver ${key} gone`);
          }
        }
      }
	  if (socket && vendors)
	  {
		  for (const [key, value] of Object.entries(vendors))
		  {
			  if (value && value.sid == socket.id)
			  {
				  delete vendors[key];
				  log.info(`disconnect > Vendor ${key} gone`);
			  }
		  }
	  }
    }
    catch (err) {
      log.error(`disconnect > ${err.message}`);
    }
  }); // disconnect


   socket.on('ack', function (data) 
   {
    try 
	{
		if(data.Purpose == "DriverJob")
		{
		  for (var i = 0; i < messagePool.length; i++) 
		  {
			if (messagePool[i].driverId == data.TypeId && messagePool[i].method == data.Purpose) 
			{
				messagePool.splice(i, 1);
			}
		  }
		}
		else if(data.Purpose == "VendorJob")
		{
		  for (var i = 0; i < messagePool.length; i++) 
		  {
			if (messagePool[i].vendorId == data.TypeId && messagePool[i].method == data.Purpose) 
			{
				messagePool.splice(i, 1);
			}
		  }
		}
    }
	catch (err) 
	{
      log.error(`ack error > ${err.message}`);
    }

  }); // Job Remove
	
  socket.on('sendToClient', function (input) {

    try 
	{
      log.info(`sendToClient Input: ${JSON.stringify(input)}`);
      
	  if(input.TypeName == "Driver")
	  {
		  messagePool.push({ 'TypeName': input.TypeName, 'driverId': input.TypeId, 'data': input.Data, 'method': input.Purpose, 'time': Date.now() });
		  log.info(`Sending ${input.Purpose} to driver ${input.TypeId}`);
		  drivers[input.TypeId].socket.emit('ServerResponse', { 'Method': input.Purpose, 'Data': input.Data });
	  }
	  else if(input.TypeName == "Vendor")
	  {
		  messagePool.push({ 'TypeName': input.TypeName, 'vendorId': input.TypeId, 'data': input.Data, 'method': input.Purpose, 'time': Date.now() });
		  log.info(`Sending ${input.Purpose} to vendor ${input.TypeId}`);
		  vendors[input.TypeId].socket.emit('ServerResponse', { 'Method': input.Purpose, 'Data': input.Data });
	  }
    }
    catch (err) 
	{
      log.error(`sendToClient error: > ${err.message}`);
    }

  }); // sendToClient


  socket.on('sendToServer', function (input) {

    try {
      log.info(`sendToServer: ${JSON.stringify(input)} `);
      input = JSON.parse(input);
      if (input.Method == "SendLocationData") 
	  {
        CallAPISendDriverLocation(input.Data);
        socket.emit('SendLocationDataChanged', true);
      }

    } catch (err) {
      log.error(`sendToServer error: ${err.message} `);
    }

  });


  socket.on('getClientsInfo', function () {

    try {
      var availableClients = [];
      let drivercount = Object.keys(drivers).length;
      let vendorcount = Object.keys(vendors).length;
      for (const [key, value] of Object.entries(drivers)) 
	  {
        //log.info(`key.......: ${key}`);
        //log.info(`value.....: ${value}`);
        //log.info(`client.... ${clients[key]}, value....${value}`);
        availableClients.push({ driverId: key, socketId: value.socket.id });
      }
	  for (const [key, value] of Object.entries(vendors)) 
	  {
        //log.info(`key.......: ${key}`);
        //log.info(`value.....: ${value}`);
        //log.info(`client.... ${clients[key]}, value....${value}`);
        availableClients.push({ vendorId: key, socketId: value.socket.id });
      }
	  
      socket.emit('getClientsInfoResponse', availableClients);
    }
    catch (err) {
      log.error(`getClientsInfo error: > ${err.message}`);
    }

  });


  socket.on('SendLocationData', function (input) {
    try {
      log.info(`SendLocationData: ${JSON.stringify(input)}`);
      CallAPISendDriverLocation(input);
      socket.emit('SendLocationDataChanged', true);
    }
    catch (err) {
      log.error(`SendLocationData error: > ${err.message}`);
    }

  });
  
  socket.on('clrMessagePool', function (data) {
	try
	{
		messagePool = [];
		log.info(`Message Pool Cleared`);
	}
	catch(err)
	{
		log.error(`Clear Message Pool error: > ${err.message}`);
	}
  });
	
	
   socket.on('getPoolInfo', function () {

    try {  
	  
      socket.emit('getPoolInfoResponse', messagePool);
    }
    catch (err) {
      log.error(`getPoolInfo error: > ${err.message}`);
    }

  });
  
  socket.on('ackVendorController', function (input) 
   {
    try 
	{
		if(input.Purpose == "VendorJob")
		{
		  for (var i = 0; i < messagePool.length; i++) 
		  {
			if (messagePool[i].data == input.Data && messagePool[i].method == input.Purpose) 
			{
				var currentvendor = messagePool[i].vendorId;
				var Purpose = "";
				messagePool.splice(i, 1);
				
				if(input.TypeId == 1)
				{
					Purpose = "accepted";
					log.info(`Ack type => ${input.TypeId} > ${Purpose}`);
					vendors[currentvendor].socket.emit('Accepted', { 'Method': Purpose, 'Data': input.Data });
				}
				else if (input.TypeId == 2)
				{
					Purpose = "cancelled";
					log.info(`Ack type => ${input.TypeId} > ${Purpose}`);
					vendors[currentvendor].socket.emit('Accepted', { 'Method': Purpose, 'Data': input.Data });
				}
			}
		  }
		}
    }
	catch (err) 
	{
      log.error(`ack error > ${err.message}`);
    }

  }); // Vendor Job Remove By Controller


}); // connection


function CallAPISendDriverLocation(input) {
  try {
    //---------------------------axios module------------------------------
    const axios = require('axios').default;
    //var newPost = JSON.parse(ReqJSon);
    let sendPostRequest = async () => {
      try {

        log.info(`send driver location input => ${JSON.stringify(input)}`);

        let resp = await axios.post(process.env.apiPath + "GetSocket/", input);

        //console.log('1.5 WAITING AREA----------------------------------------------CODE STATUS: '+ resp.status);
        //log.info(`API Status Code: ${resp.status}`);
        //log.info(`API resp.data: ${resp.data}`);
        //console.log(resp.data);
      } catch (err) {
        // Handle Error Here
        log.error(`axio api error: ${err.message}`);
      }
    };
    sendPostRequest();
  }
  catch (err) {
    log.error(`CallAPISendDriverLocation error: ${err.message} `);
  }
}


app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});


server.listen(process.env.PORT, () => {
  console.log(`listening on *: ${process.env.PORT}`);
  log.info(`Server started, Environment = ${process.env.NODE_ENV}, Port = ${process.env.PORT}, VirtualDirPath = ${virtualDirPath} `);
});