import express from 'express';
import * as dotenv from 'dotenv';
dotenv.config();

import { startWorkerLoop } from './scraper.js';
import { state } from './state.js';

const app = express();
const PORT = process.env.PORT || 8080;


app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>INPI Worker Dashboard</title>
                <style>
                    body { font-family: sans-serif; padding: 20px; background: #f4f4f9; color: #333; }
                    .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 600px; margin: 0 auto; }
                    h1 { color: #2c3e50; }
                    .status { font-weight: bold; color: ${state.status === 'Running' ? 'green' : state.status === 'Error' ? 'red' : 'orange'}; }
                    .metric { margin-top: 10px; font-size: 1.1em; }
                </style>
                <meta http-equiv="refresh" content="5">
            </head>
            <body>
                <div class="card">
                    <h1>⚙️ INPI Worker Status</h1>
                    <div class="metric">Status: <span class="status">${state.status}</span></div>
                    <div class="metric">Patents Processed: <b>${state.totalProcessed}</b></div>
                    <div class="metric">Errors Encountered: <b>${state.errors}</b></div>
                    <div class="metric">Current RPI / Date: <b>${state.currentRPI || 'Initializing...'}</b></div>
                    <div class="metric">Last Patent: <b>${state.lastPatentProcessed || 'None'}</b></div>
                </div>
            </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`[Dashboard] Server listening on port ${PORT}`);

    // Start the worker loop in the background
    startWorkerLoop().catch(err => {
        console.error("Fatal error in worker loop:", err);
    });
});
