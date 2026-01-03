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

// Helper function to validate and get account info
function getAccountInfo(accountParam, response) {
    if (!process.env.accountnum || !process.env.accountname) {
        console.error("Missing environment variables: accountnum or accountname");
        response.status(500).send("Server configuration error");
        return null;
    }

    const accts = process.env.accountnum.split(',');
    const names = process.env.accountname.split(',');
    
    // Support comma-separated list of accounts
    const requestedAccts = accountParam.split(',').map(a => a.trim());
    const accountInfos = [];
    
    for (const reqAcct of requestedAccts) {
        const acctIndex = accts.indexOf(reqAcct);
        if (acctIndex >= 0) {
            accountInfos.push({
                acct: accts[acctIndex],
                name: names[acctIndex]
            });
        } else {
            console.error("Invalid account requested:", reqAcct);
        }
    }
    
    if (accountInfos.length === 0) {
        response.status(404).send("Invalid account");
        return null;
    }

    return {
        accounts: accountInfos,
        accts: accts,
        names: names,
        requestParam: accountParam
    };
}

// https://expressjs.com/en/starter/basic-routing.html
app.get("/:acct.ics", (request, response) => {
    const accountInfo = getAccountInfo(request.params.acct, response);
    if (!accountInfo) return;

    const { accounts } = accountInfo;
    
    // Fetch data for all accounts in parallel
    const fetchPromises = accounts.map(accountData => {
        const url = "https://water.gateway.srpnet.com/schedule/account/" + accountData.acct + "/quickview";
        console.log(new Date() + " Requesting data for account number " + accountData.acct + " from ", url);
        
        return fetch(url)
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
            .then(data => ({
                success: true,
                accountData: accountData,
                data: data
            }))
            .catch(error => {
                console.error("Fetch Error for account", accountData.acct, ":", error);
                return {
                    success: false,
                    accountData: accountData,
                    error: error.message
                };
            });
    });

    Promise.all(fetchPromises)
        .then(results => {
            // Create calendar with name based on number of accounts
            const calName = accounts.length > 1 
                ? 'Irrigation - Multiple Accounts' 
                : 'Irrigation ' + accounts[0].name;
            
            const cal = ical({
                domain: hostname,
                name: calName,
                url: request.url
            });

            // Add events for each successful account fetch
            results.forEach(result => {
                if (result.success) {
                    const accountData = result.accountData;
                    const data = result.data;
                    
                    const event = cal.createEvent({
                        id: data.id + '-' + accountData.acct,
                        summary: "Irrigation - " + accountData.name + ": " + data.orderStatus,
                        description: data.irrigationNotice + '\nUpdated: ' + new Date(),
                        location: data.displayFirstAccountScheduleDetail.address,
                        start: data.onDateTime + process.env.tzoffset,
                        end: data.offDateTime + process.env.tzoffset,
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
                    });
                }
            });

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
    const accountInfo = getAccountInfo(request.params.acct, response);
    if (!accountInfo) return;

    const { accounts, accts, names, requestParam } = accountInfo;
    
    // Update saved accounts cookie
    let savedAccounts = [];
    try {
        savedAccounts = request.cookies.savedAccounts ? JSON.parse(request.cookies.savedAccounts) : [];
    } catch (e) {
        savedAccounts = [];
    }
    
    // Add all requested accounts to saved list
    for (const accountData of accounts) {
        savedAccounts = savedAccounts.filter(a => a !== accountData.acct);
        savedAccounts.unshift(accountData.acct);
    }
    
    // Keep only last 10 accounts
    savedAccounts = savedAccounts.slice(0, 10);
    
    response.cookie('savedAccounts', JSON.stringify(savedAccounts), { maxAge: 365 * 24 * 60 * 60 * 1000 }); // 1 year
    response.cookie('lastAccount', requestParam, { maxAge: 365 * 24 * 60 * 60 * 1000 }); // 1 year

    // Fetch data for all accounts in parallel
    const fetchPromises = accounts.map(accountData => {
        const url = "https://water.gateway.srpnet.com/schedule/account/" + accountData.acct + "/quickview";
        console.log(new Date() + " Requesting data for account number " + accountData.acct + " from ", url);
        
        return fetch(url)
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
            .then(data => ({
                success: true,
                accountData: accountData,
                data: data
            }))
            .catch(error => {
                console.error("Fetch Error for account", accountData.acct, ":", error);
                return {
                    success: false,
                    accountData: accountData,
                    error: error.message
                };
            });
    });

    Promise.all(fetchPromises)
        .then(results => {
            // Build account switcher dropdown
            let savedAccountsList = [];
            try {
                savedAccountsList = request.cookies.savedAccounts ? JSON.parse(request.cookies.savedAccounts) : [];
            } catch (e) {
                savedAccountsList = [];
            }
            
            let accountSwitcher = '';
            if (savedAccountsList.length > 0) {
                accountSwitcher = '<div class="account-switcher">';
                accountSwitcher += '<label for="account-select">Switch Account:</label>';
                accountSwitcher += '<select id="account-select" onchange="window.location.href=\'/\'+this.value">';
                
                // Add option to view all if multiple accounts
                if (savedAccountsList.length > 1) {
                    const allAccts = savedAccountsList.join(',');
                    const selectedAll = requestParam === allAccts ? ' selected' : '';
                    accountSwitcher += `<option value="${allAccts}"${selectedAll}>View All</option>`;
                }
                
                savedAccountsList.forEach(savedAcct => {
                    const savedAcctIndex = accts.indexOf(savedAcct);
                    if (savedAcctIndex >= 0) {
                        const savedName = names[savedAcctIndex];
                        const selected = requestParam === savedAcct ? ' selected' : '';
                        accountSwitcher += `<option value="${savedAcct}"${selected}>${savedName}</option>`;
                    }
                });
                
                accountSwitcher += '</select></div>';
            }
            
            // Build schedule sections for each account
            let schedulesSections = '';
            results.forEach((result, index) => {
                if (result.success) {
                    const nextDate = new Date(result.data.onDateTime + process.env.tzoffset);
                    const accountData = result.accountData;
                    
                    schedulesSections += `
        <div class="schedule-section${index > 0 ? ' schedule-separator' : ''}">
            <h2>${accountData.name}</h2>
            <div class="info"><span class="label">Status:</span> ${result.data.orderStatus}</div>
            <div class="info"><span class="label">Next Irrigation Date:</span></div>
            <div class="date">${nextDate.toLocaleString()}</div>
            <div class="info"><span class="label">Location:</span> ${result.data.displayFirstAccountScheduleDetail.address}</div>
            <div class="info">${result.data.irrigationNotice}</div>
            <a href="/${accountData.acct}.ics">Download Calendar (.ics)</a>
        </div>`;
                } else {
                    schedulesSections += `
        <div class="schedule-section${index > 0 ? ' schedule-separator' : ''}">
            <h2>${result.accountData.name}</h2>
            <div class="error">Unable to fetch irrigation data</div>
        </div>`;
                }
            });
            
            const pageTitle = accounts.length > 1 ? 'Irrigation Schedules' : `Irrigation Schedule - ${accounts[0].name}`;
            
            const html = `
<!DOCTYPE html>
<html>
<head>
    <title>${pageTitle}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
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
        h2 {
            color: #34495e;
            margin-top: 0;
            margin-bottom: 15px;
            font-size: 22px;
        }
        .schedule-section {
            margin-bottom: 20px;
        }
        .schedule-separator {
            padding-top: 30px;
            border-top: 2px solid #ecf0f1;
        }
        .account-switcher {
            margin-bottom: 20px;
            padding-bottom: 20px;
            border-bottom: 2px solid #ecf0f1;
        }
        .account-switcher label {
            display: block;
            margin-bottom: 8px;
            font-weight: bold;
            color: #2c3e50;
        }
        .account-switcher select {
            width: 100%;
            padding: 10px;
            font-size: 16px;
            border: 1px solid #bdc3c7;
            border-radius: 5px;
            background-color: white;
            cursor: pointer;
        }
        .account-switcher select:hover {
            border-color: #3498db;
        }
        .account-switcher select:focus {
            outline: none;
            border-color: #3498db;
            box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
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
        .error {
            color: #e74c3c;
            padding: 10px;
            background-color: #fadbd8;
            border-radius: 5px;
            margin: 10px 0;
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
        <h1>${accounts.length > 1 ? 'Irrigation Schedules' : 'Irrigation Schedule'}</h1>
        ${accountSwitcher}
        ${schedulesSections}
    </div>
</body>
</html>
            `;
            response.send(html);
        })
        .catch(error => {
            console.error("Error processing requests:", error);
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
