#!/usr/bin/env node
// ----------------------------------------------------------------------------
//  Copyright (C) Microsoft. All rights reserved.
//  Licensed under the MIT license.
// ----------------------------------------------------------------------------

const colors   = require('colors');
const crypto   = require('crypto');
const fs       = require('fs');
const path     = require('path');
const isBase64 = require('is-base64');
const request  = require('request');
const wifi     = require('node-wifi');

var MASTERKEY = "", BASEREGID = "", SCOPEID = "", SSID = "", PASSWD = "";
var urlencode = encodeURIComponent;

function computeDrivedSymmetricKey(masterKey, regId) {
  return crypto.createHmac('SHA256', Buffer.from(masterKey, 'base64'))
    .update(regId, 'utf8')
    .digest('base64');
}

async function main() {
  var version = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'))).version;
  console.log(`\nAzure IoT DPS Symetric Key Generator v${version}`);

  if (process.argv.length < 4) {
    console.log("Usage:");
    console.log(colors.yellow("dps-keygen"), "<master-key>", "<registrationId>", "<option scope id>", "<opt ssid>", "<opt pass>");
    process.exit(0);
  }

  MASTERKEY = process.argv[2];
  BASEREGID = process.argv[3];

  if (!isBase64(MASTERKEY)) {
    console.error(colors.red('\nerror :'), "invalid entry");
    console.log("\texpects a base64 encoded master key");
    process.exit(1);
  }

  console.log("MASTER-KEY:", MASTERKEY);
  console.log("BASE-DEVICE-ID:", BASEREGID);

  if (process.argv.length == 7) {
    console.log("Scanning Devices...");
    SCOPEID = urlencode(process.argv[4]);
    SSID = urlencode(process.argv[5]);
    PASSWD = urlencode(process.argv[6]);

    updateDevices();
  } else {
    console.log("\nplease find the device key below.")
    console.log(colors.magenta(computeDrivedSymmetricKey(MASTERKEY + "",
          BASEREGID + "")), "\n");
  }
}

var RUN = 1;
main();

function updateDevices() {
  wifi.init({
      iface : null // network interface, choose a random wifi interface if set to null
  });

  var mxnetworks = [];

  function doconnect() {
    if (mxnetworks.length == 0) { if (RUN < 3) updateDevices(); else return; }
    var net = mxnetworks.pop();
    if (!net) {
      setTimeout(doconnect, 1000);
      RUN++;
      return;
    }
    wifi.connect({ssid:net.ssid, password:""}, function(err) {
      console.log("network ssid:", net.ssid)
      console.log("Updating..");
      if (err) {
        setTimeout(doconnect, 1000);
        RUN++;
      }
      var mac = net.bssid.split(':');
      var PINCO = mac[0].toUpperCase() + mac[1].toUpperCase();
      var REGID = urlencode(BASEREGID + mac[mac.length - 2] + mac[mac.length - 1]);
      SASKEY = computeDrivedSymmetricKey(MASTERKEY + "", REGID + "");
      SASKEY = urlencode(SASKEY);

      var connstr = `http://192.168.0.1/PROCESS?SSID=${SSID}&PASS=${PASSWD}&PINCO=${PINCO}&SCOPEID=${SCOPEID}&REGID=${REGID}&AUTH=S&SASKEY=${SASKEY}&HUM=1&MAG=1&GYRO=1&TEMP=1&PRES=1&ACCEL=1`;

      process.stdout.write('.');
      var doitCount = 0;
      function doit() {
          request(connstr, {timeout: 10000}, function (error, response, body) {
            process.stdout.write('.');
            if (!error || doitCount != 0) {
              setTimeout(function() {
                console.log("done! deviceid:", REGID);
                doconnect();
              }, 1000);
            } else {
              doitCount++;
              setTimeout(doit, 1000);
            }
          });
      }
      setTimeout(doit, 2000);
    });
  }

  // Scan networks
  wifi.scan(function(err, networks) {
      if (err) {
          console.log(err);
      } else {
        for(var o in networks) {
          var network = networks[o];
          if (network.ssid.indexOf('AZ3166_') == 0) {
            mxnetworks.push(network);
          }
        }

        if (mxnetworks.length == 0) {
          if (RUN == 1) {
            console.log("No MXCHIP broadcast was found. Have you reset them to AP mode?");
          }
          process.exit(0);
        }
        RUN++;
        doconnect();
      }
  });
}
