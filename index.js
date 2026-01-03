import dotenv from 'dotenv';
import express from "express";
import fetch from "node-fetch";
import ical from "ical-generator";
import os from 'os';
import cookieParser from 'cookie-parser';

dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['PORT', 'accountnum', 'accountname', 'tzoffset'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
    console.error('❌ Configuration Error: Missing required environment variables:');
    missingEnvVars.forEach(varName => {
        console.error(`   - ${varName}`);
    });
    console.error('\nPlease create a .env file with the following variables:');
    console.error('   PORT=3000');
    console.error('   accountnum=12345,67890');
    console.error('   accountname=Account 1,Account 2');
    console.error('   tzoffset=-07:00');
    console.error('\nSee .env.example for reference.');
    process.exit(1);
}

// Validate account configuration
const accts = process.env.accountnum.split(',');
const names = process.env.accountname.split(',');

if (accts.length !== names.length) {
    console.error('❌ Configuration Error: Mismatch between accountnum and accountname');
    console.error(`   Found ${accts.length} account number(s) but ${names.length} account name(s)`);
    console.error('   These must have the same number of comma-separated values.');
    process.exit(1);
}

console.log('✓ Configuration validated');
console.log(`✓ Loaded ${accts.length} account(s): ${names.join(', ')}`);

const app = express();
app.use(cookieParser());
const hostname = os.hostname();

// process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
// require("https").globalAgent.options.ca = require("ssl-root-cas/latest").create();
import fs from 'fs';
//import https from 'https'
//https.globalAgent.options.ca = fs.readFileSync("node_modules/node_extra_ca_certs_mozilla_bundle/ca_bundle/ca_intermediate_root_bundle.pem");

// https://expressjs.com/en/starter/basic-routing.html
app.get("/:acct.ics", (request, response) => {
    if (!process.env.accountnum || !process.env.accountname) {
        console.error("Missing environment variables: accountnum or accountname");
        return response.status(500).send("Server configuration error");
    }

    const accts = process.env.accountnum.split(',');
    const names = process.env.accountname.split(',');

    const acctIndex = accts.indexOf(request.params.acct);

    if (acctIndex < 0) {
        console.error("Invalid account requested:", request.params.acct);
        return response.status(404).send("Invalid account");
    }

    const acct = accts[acctIndex];
    const name = names[acctIndex];
    const url = "https://water.gateway.srpnet.com/schedule/account/" + acct + "/quickview";
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
		    }]
            });

            //event.createAlarm({
            //	type: 'audio',
            //    trigger: event.begin()
            //});

            event.createAlarm({
                type: 'audio',
                trigger: event.end()
            })

            response.setHeader('Cache-Control', 'no-cache');
            response.type('text/calendar');
            response.send(cal.toString());
        })
        .catch(error => {
            console.error("Fetch Error:", error);
            response.status(500).send("Error fetching data");
        });        
});

app.get("/:acct", (request, response) => {
    if (!process.env.accountnum || !process.env.accountname) {
        console.error("Missing environment variables: accountnum or accountname");
        return response.status(500).send("Server configuration error");
    }

    const accts = process.env.accountnum.split(',');
    const names = process.env.accountname.split(',');

    const acctIndex = accts.indexOf(request.params.acct);

    if (acctIndex < 0) {
        console.error("Invalid account requested:", request.params.acct);
        return response.status(404).send("Invalid account");
    }

    const acct = accts[acctIndex];
    const name = names[acctIndex];
    const url = "https://water.gateway.srpnet.com/schedule/account/" + acct + "/quickview";
    console.log(new Date() + " Requesting data for account number " + acct + " from ", url);

    // Set cookie for this account
    response.cookie('lastAccount', request.params.acct, { maxAge: 365 * 24 * 60 * 60 * 1000 }); // 1 year

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
            const nextDate = new Date(data.onDateTime + process.env.tzoffset);
            const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Irrigation Schedule - ${name}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 600px;
            margin: 50px auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        h1 {
            color: #2c3e50;
            margin-bottom: 20px;
        }
        .date {
            font-size: 24px;
            color: #27ae60;
            font-weight: bold;
            margin: 20px 0;
        }
        .info {
            margin: 10px 0;
            color: #555;
        }
        .label {
            font-weight: bold;
            color: #2c3e50;
        }
        a {
            display: inline-block;
            margin-top: 20px;
            padding: 10px 20px;
            background-color: #3498db;
            color: white;
            text-decoration: none;
            border-radius: 5px;
        }
        a:hover {
            background-color: #2980b9;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Irrigation Schedule</h1>
        <div class="info"><span class="label">Account:</span> ${name}</div>
        <div class="info"><span class="label">Status:</span> ${data.orderStatus}</div>
        <div class="info"><span class="label">Next Irrigation Date:</span></div>
        <div class="date">${nextDate.toLocaleString()}</div>
        <div class="info"><span class="label">Location:</span> ${data.displayFirstAccountScheduleDetail.address}</div>
        <div class="info">${data.irrigationNotice}</div>
        <a href="/${request.params.acct}.ics">Download Calendar (.ics)</a>
    </div>
</body>
</html>
            `;
            response.send(html);
        })
        .catch(error => {
            console.error("Fetch Error:", error);
            response.status(500).send("Error fetching data");
        });
});

app.get("/", (request, response) => {
    const lastAccount = request.cookies.lastAccount;
    if (lastAccount) {
        response.redirect(`/${lastAccount}`);
    } else {
        response.send("Hi.");
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something went wrong');
});

// listen for requests :)
const listener = app.listen(process.env.PORT, () => {
    const port = listener.address().port;
    console.log(`Irrigation Calendar Server running on http://localhost:${port}`);
});
