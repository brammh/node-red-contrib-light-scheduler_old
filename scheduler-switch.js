module.exports = function(RED) {
    "use strict";
    var path = require('path');
    var req = require('request');
    var util = require('util');  
    var scheduler = require('./lib/scheduler.js');
    var isItDark = require('./lib/isitdark.js');

    function SchedulerSwitch(config) {
        RED.nodes.createNode(this,config);
        this.settings = RED.nodes.getNode(config.settings); // Get global settings    
        this.events = JSON.parse(config.events);
        this.runningEvents = JSON.parse(config.events); // With possible randomness.
        this.msg = config.msg;
        this.onlyWhenDark = config.onlyWhenDark;
        this.sunElevationThreshold = config.sunElevationThreshold ? config.sunElevationThreshold : 6;
        this.scheduleRndMax = !isNaN(parseInt(config.scheduleRndMax)) ? parseInt(config.scheduleRndMax) : 0;
        this.scheduleRndMax = Math.max(Math.min(this.scheduleRndMax, 60), 0); // 0 -> 60 allowed
        
        this.topic = config.topic;
        this.onPayload = config.onPayload;
        this.onPayloadType = config.onPayloadType;
        this.offPayload = config.offPayload;
        this.offPayloadType = config.offPayloadType;
        this.showStatus = config.showStatus | false;
        this.onStart = config.onStart | false;
        this.onInput = config.onInput | true;
        this.onStateChange = config.onStateChange | false;
        this.prevPayload = null;
        this.prevState = null;
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
            var newMsg = node.msg;
            if (typeof newMsg == 'undefined')
            {
                newMsg = {topic: node.topic,};
                if(out)
                    newMsg.payload = RED.util.evaluateNodeProperty(node.onPayload, node.onPayloadType, node, newMsg);
                else
                    newMsg.payload = RED.util.evaluateNodeProperty(node.offPayload, node.offPayloadType, node, newMsg);
            }
            node.send(out?[newMsg,null]:[null,newMsg]);

            //FOR DEBUGGING
            //node.warn(`out:${out} - prevState:${node.prevState} - newPayload:${newMsg.payload} prevPayload:${node.prevPayload}`);
        }
      
        function evaluate() {        
            var matchEvent = scheduler.matchSchedule(node);
            var sunElevation = 'Sun: ' + isItDark.getElevation(node).toFixed(1) + '°';
            
            if(matchEvent==true)
            {
                if(!node.onlyWhenDark)
                {   //Schedule On, don't care about darkness
                    node.status(node.showStatus?{fill:'green',shape:'dot',text:'On, match with schedule'}:{});
                    return true;
                }
                else 
                {   //Schedule On, check if it is dark
                    if (isItDark.isItDark(node))
                    {   //It's dark
                        node.status(node.showStatus?{fill:'green',shape:'dot',text: 'On, ' +sunElevation}:{});
                        return true;
                    }
                    else
                    {   //Schedule On, but it's not dark
                        node.status(node.showStatus?{fill:'yellow',shape:'dot',text:'Match with schedule, not dark yet, '  +sunElevation}:{});
                        return false;
                    }
                } 
            }
            //Schedule==Off -> Off
            node.status(node.showStatus?{fill:'red',shape:'dot',text:'Off, no match with schedule'}:{});
            return false;    
        }

        function stateWatcher(){
            var newValue = evaluate();

            //Send value if statuschanges should be reported, and value differs from previous
            if(node.onStateChange)
            {
                if ((newValue!=node.prevState)&&(node.prevState!=null))
                {
                    //different status, send message
                    setState(newValue);
                }
                node.prevState = newValue;
            }
        }
        
        function start()
        {
            setState(evaluate());
        }       

        node.on('input', function(msg) {
            node.msg = msg;
            setState(evaluate());
        });

        //evaluate at the start (trigger node at start)
        if(node.onStart)
        {
            setTimeout(start, 1000);
        }

        //Check status continiously, and update if state changed
        node.evalInterval = setInterval(stateWatcher, 30000);
    
        node.on('close', function() {
            clearInterval(node.evalInterval);
        });

        if(node.scheduleRndMax > 0) {
            randomizeSchedule();
            // Randomize schedule every hour for now, could cause problems with large scheduleRndMax.
            node.rndInterval = setInterval(randomizeSchedule, 1*60*60*1000);
          }
    }
    RED.nodes.registerType("scheduler-switch",SchedulerSwitch);

    RED.httpAdmin.get('/light-scheduler/js/*', function(req,res) {
        var options = {
            root: __dirname + '/static/',
            dotfiles: 'deny'
        };
        res.sendFile(req.params[0], options);
    });
}