module.exports = function(RED) {
  "use strict";
  var path = require('path');
  var req = require('request');
  var util = require('util');  
  var scheduler = require('./lib/scheduler.js');
  var isItDark = require('./lib/isitdark.js');

  var LightScheduler = function(n) {

    RED.nodes.createNode(this, n);
    this.settings = RED.nodes.getNode(n.settings); // Get global settings    
    this.events = JSON.parse(n.events);
    this.runningEvents = JSON.parse(n.events); // With possible randomness.
    this.topic = n.topic;
    this.onPayload = n.onPayload;
    this.onPayloadType = n.onPayloadType;
    this.offPayload = n.offPayload;
    this.offPayloadType = n.offPayloadType;
    this.onlyWhenDark = n.onlyWhenDark;
    this.sunElevationThreshold = n.sunElevationThreshold ? n.sunElevationThreshold : 6;
    this.sunShowElevationInStatus = n.sunShowElevationInStatus | false;
    this.outputfreq = n.outputfreq ? n.outputfreq : 'output.statechange.startup';
    this.scheduleRndMax = !isNaN(parseInt(n.scheduleRndMax)) ? parseInt(n.scheduleRndMax) : 0;
    this.scheduleRndMax = Math.max(Math.min(this.scheduleRndMax, 60), 0); // 0 -> 60 allowed
    this.override = 'auto';
    this.prevPayload = null;
    var node = this;


    function randomizeSchedule() {
      function offsetMOD() {
        var min = 0 - node.scheduleRndMax;
        var max = node.scheduleRndMax;
        return Math.floor(Math.random() * (max - min) + min);
      }

      node.runningEvents = node.events.map((event) => {
        var minutes = event.end.mod - event.start.mod;
        event.start.mod = event.start.mod + offsetMOD();
        event.end.mod = event.end.mod + offsetMOD();                

        if(event.end.mod <= event.start.mod) // Handle "too short events"
          event.end.mod = event.start.mod + minutes; // Events can overlap, but we don't need to care about that

        return event;
      });
    }
    

    function setState(out) {
      var msg = {
        topic: node.topic,
      };
      if(out)
        msg.payload = RED.util.evaluateNodeProperty(node.onPayload, node.onPayloadType, node, msg);
      else
        msg.payload = RED.util.evaluateNodeProperty(node.offPayload, node.offPayloadType, node, msg);

      var sunElevation = '';
      if(node.sunShowElevationInStatus) {
        sunElevation = '  Sun: ' + isItDark.getElevation(node).toFixed(1) + '°';
      }

      var overrideTxt = node.override == 'auto'?'':'  Override: ' + node.override;
      node.status({fill: out?"green":"red", shape: "dot", text: (out ? 'ON' : 'OFF') + sunElevation + overrideTxt});

      // Only send anything if the state have changed.
      if(node.outputfreq == 'output.minutely' || msg.payload !== node.prevPayload)
      {
        node.send(msg);
        node.prevPayload = msg.payload;
      }
    }


    function evaluate() {      
      // Handle override state, if any.   
      if(node.override == 'stop') {
        node.status({fill: "gray", shape: "dot", text: 'Override: Stopped!'});        
        return;
      }

      if(node.override == 'on')
        return setState(true);

      if(node.override == 'off')
        return setState(false);

      var matchEvent = scheduler.matchSchedule(node);

      if(node.override == 'schedule-only')
        return setState(matchEvent);

      if(node.override == 'light-only')
        return setState(isItDark.isItDark(node));


//if(node.override == 'auto')
//        {
//          return;
//        }
        // node.override == auto
      if(!matchEvent)
        return setState(false);

      if(node.onlyWhenDark)
        return setState(isItDark.isItDark(node));

      return setState(true);
    }


    node.on('input', function(msg) {
      msg.payload = msg.payload.toString(); // Make sure we have a string.
      if(msg.payload.match(/^(1|on|0|off|auto|stop|schedule-only|light-only)$/i))
      {
        if(msg.payload == '0') msg.payload = 'off';
        if(msg.payload == '1') msg.payload = 'on';
        node.override = msg.payload.toLowerCase();
        //console.log("Override: " + node.override);
      }
      else
        node.warn('Failed to interpret incomming msg.payload. Ignoring it!');

      evaluate();
    });

    // re-evaluate every minute
    node.evalInterval = setInterval(evaluate, 60000);

    // Run initially directly after start / deploy.
    if(node.outputfreq != 'output.statechange')
      setTimeout(evaluate, 1000);

    node.on('close', function() {
      clearInterval(node.evalInterval);
      clearInterval(node.rndInterval);
    });

    if(node.scheduleRndMax > 0) {
      randomizeSchedule();
      // Randomize schedule every hour for now, could cause problems with large scheduleRndMax.
      node.rndInterval = setInterval(randomizeSchedule, 1*60*60*1000);
    }

	};


  RED.nodes.registerType("light-scheduler", LightScheduler);

  RED.httpAdmin.get('/light-scheduler/js/*', function(req,res) {
    var options = {
      root: __dirname + '/static/',
      dotfiles: 'deny'
    };
    res.sendFile(req.params[0], options);
  });
};