require('dotenv').config()

const express = require("express");
const app = express();
const fetch = require("node-fetch");
const ical = require("ical-generator");
const hostname = require("os").hostname();

// process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
// require("https").globalAgent.options.ca = require("ssl-root-cas/latest").create();
const fs = require("fs");
require("https").globalAgent.options.ca = fs.readFileSync("node_modules/node_extra_ca_certs_mozilla_bundle/ca_bundle/ca_intermediate_root_bundle.pem");

// https://expressjs.com/en/starter/basic-routing.html
app.get("/:acct.ics", (request, response) => {
    const accts = process.env.accountnum.split(',');
    const names = process.env.accountname.split(',');

    const acctIndex = accts.indexOf(request.params.acct);

    if (acctIndex < 0) {
        throw new Error("INVALID ACCOUNT " + request.params.acct);
    }

    const acct = accts[acctIndex];
    const name = names[acctIndex];
    const url = "https://water.gateway.srpnet.com/schedule/account/" + acct;
    console.log(new Date() + " Requesting data for account number " + acct + " from ", url);

    fetch(url)
        .then(fetchResponse => {
            if (!fetchResponse.ok) {
                throw new Error(
                    "Error fetching account data: " +
                    fetchResponse.status +
                    " " +
                    fetchResponse.statusText
                );
            }
            return fetchResponse.json();
        })
        .then(data => {
            const cal = ical({
                domain: hostname,
                //timezone: process.env.timezone,
                name: 'Irrigation ' + name,
                url: request.url
                });

            const event = cal.createEvent({
                id: data.id,
                summary: "Irrigation - " + name + ": " + data.orderStatus,
                description: data.irrigationNotice + '\nUpdated: ' + new Date(),
                location: data.displayFirstAccountScheduleDetail.address,
                start: data.onDateTime + process.env.tzoffset,
                end: data.offDateTime + process.env.tzoffset,
                //timezone: data.timezone,
                alarms: [
                    {
                        type: 'display',
                        trigger: 300
                    },
                    {
                        type: 'audio',
                        trigger: 1
                    }
                ]
            });

            event.createAlarm({
                type: 'audio',
                trigger: event.end()
            })

            response.setHeader('Cache-Control', 'no-cache');
            response.type('text/calendar');
            response.send(cal.toString());
        })
        .catch(error => {
            console.log("Fetch Error", error);
        });        
});

app.get("/", (request, response) => {
    response.send("Hi.");
});

// listen for requests :)
const listener = app.listen(process.env.PORT, () => {
    console.log("Irrigation Calendar is listening on port " + listener.address().port);
});
