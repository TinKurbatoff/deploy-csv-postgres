import { seedDatabase } from "../ETL/seedDB";
import { performance } from "node:perf_hooks";
import { createAWSStream } from "../API/s3Stream";

// Read config file
require('dotenv').config();

// Create S3 Object
import AWS from 'aws-sdk';
AWS.config.loadFromPath('aws-config.json');
const s3 = new AWS.S3({httpOptions: {timeout: 3000}});
// const s3 = new AWS.S3();
// var fs = require('fs')  // Was used for testing with local files

// Import PostgreSQL controllers
import { Pool } from 'pg';
import type { PoolClient, QueryResult } from 'pg';
var copyFrom = require('pg-copy-streams').from

// Load settings
console.log("Settings applied:")
console.log(`DB host:${process.env.RDS_HOSTNAME}`)
console.log(`DB port:${process.env.RDS_PORT}`)
console.log(`DB name:${process.env.RDS_DATABASE}`)
console.log(`DB user:${process.env.RDS_USERNAME}`)
const addressesTableName = process.env.ADDR_TABLE_NAME || "addresses";
const chunkSize = Number(process.env.RDS_STREAM_CHUNK) || 32;

// These variables comes from the request
const bucket = "zip-unzip-bucket"
// const fileKey = "unziped/property.csv"
const fileKey = "/property_100.csv"


let pool = new Pool({ // Let use Pooling now
    // In production I will use environment variables
    user: process.env.RDS_USERNAME,
    password: process.env.RDS_PASSWORD,
    database: process.env.RDS_DATABASE,
    host: process.env.RDS_HOSTNAME,
    port: Number(process.env.RDS_PORT) || 5432,
    ssl: process.env.DB_SSL === "True"? { rejectUnauthorized: false } : false,
  });  

async function updateStateDb(pool:Pool | PoolClient, state:string, value:any) {
    // YUpdate state in DB
    return pool.query(`INSERT INTO system_states (state_id, spare_field)
        VALUES($1, $2) 
        ON CONFLICT (state_id) 
        DO UPDATE SET spare_field = $2 WHERE system_states.state_id = $1 RETURNING *;`, [state, value])

    }

async function getStateDb(pool: Pool | PoolClient, state:string) {
        console.log(`CHECK state:${state}`)
        // Read state from DB
        return pool.query(`SELECT spare_field FROM system_states WHERE state_id = $1;`, [state])
    }    

async function deployDataToDB(client: Pool, bucket: string, fileKey: string, resetDb: boolean) {
        ///  IMPORT DATA INTO POSTGRES
        let startTime = performance.now()
        let poolClient = await client.connect()
        // Check if DB is already updating with new data
        let isAllowed: {rows: any[]} = {rows: []}
        let insertResult: string = 'No pipe established!';
        try {
            isAllowed = await getStateDb(client, 'on_data_update') // Update state in DB
            }
        catch (e: any) {
            // ** FORCEFULLY ** RESET DB IF STATE TABLE IS NOT EXISTS
            // Seed database
            let createResult = await seedDatabase(client, addressesTableName, true)  
            console.log(`TABLE CREATION RESULT: ${createResult}`)  // ** Sanity check **
            isAllowed.rows = []
            return {result: "Creatd databases and exit"}
            }

        // RESET DATABASE IF REQUIRED BY THE EVENT KEY
        if (resetDb) {
            // Seed database
            const createResult = await seedDatabase(client, addressesTableName, resetDb)  
            console.log(`TABLE CREATION RESULT: ${createResult}`)  // ** Sanity check **
            }

        // console.log(isAllowed)
        if (isAllowed.rows.length > 0 && isAllowed.rows[0]?.spare_field === 'true') {
            console.log(isAllowed.rows[0])
            console.log('It is already in the updating process! Exiting...')
            // Is already in the process! Exiting...
            return { statusCode: 200, body: JSON.stringify('It is already in the updating process! Exiting...'), };
        } else {
            console.log(isAllowed?.rows[0])
            console.log('Lock updating state...')
            await updateStateDb(client, 'on_data_update', 'true') // Update state in DB
            console.log('Locked.')
            }

        // Create upward stream to Postgress DB
        let stream = poolClient.query(copyFrom(`COPY ${addressesTableName}(fips  , apn  , street_number  , street_pre_direction  , street_name  , street_suffix  , street_post_direction  , unit_type  , unit_number  , formatted_street_address  , city  , state  , zip_code  , zip_plus_four_code  , latitude  , longitude  , geocoding_accuracy  , census_tract  , carrier_code  ) FROM STDIN CSV HEADER`))    
        
        // Create downward stream from S3 bucket
        console.log(`CHUNK SIZE ${chunkSize} MB`)
        let fileStream = await createAWSStream(s3, bucket, fileKey, chunkSize)
        let fileFromPath = `s3://${bucket}/${fileKey}`
        
        // Create downward stream from *LOCAL FILE*
        // const fileFromPath = process.env.DATA_FILE_URI  
        // const fileFromPath = "./property_100.csv"  
        // let fileStream = await fs.createReadStream(fileFromPath)  // Used for tests
        
        // —— Hadlers ——
        fileStream.on('finish', () => {
            console.log("FILE READ FINISHED!")
            })

        fileStream.on('progress', async (progress: number) => {
            let stateString = `progress: ${(progress/ 1024 / 1024).toFixed(3)} Mb`
            console.log(stateString)
            await updateStateDb(poolClient, 'progress', progress) // Update state in DB
            insertResult = stateString;
            })

        fileStream.on('error', (err: any) => {
            console.error("INPUT FILE ERR:", err);
            })        

        stream.on('error', (err: any) => {
            console.error("ERR:", err);
            })
        
        stream.on('finish', async () => {
            console.log("*STREAM FINISHED*");
            await updateStateDb(poolClient, 'on_data_update', 'false') // Update state in DB
            await updateStateDb(poolClient, 'row_count', stream.rowCount) // Update state in DB
            let timeElapsed = (performance.now() - startTime) / 1000  // convert ms to seconds
            insertResult = `Inserted ${stream.rowCount} lines | took ${timeElapsed.toFixed(6)} s | csv_read_all:${fileFromPath}`
            console.log(insertResult) 
            // Calculate memory burden 
            const used = process.memoryUsage().heapUsed / 1024 / 1024;
            console.log(`The script uses approximately ${Math.round(used * 100) / 100} MB`);
            // poolClient.end()
            // pool.end()
            return { statusCode: 200, body: JSON.stringify(insertResult), };
            })
            
        // Connect streams to each other
        await fileStream.pipe(stream)        
        await updateStateDb(poolClient, 'on_data_update', 'false') // Update state in DB
            .then(async () => {await updateStateDb(poolClient, 'dumb_state', 'empty')})
            .then(() => {return { statusCode: 200, body: JSON.stringify(insertResult), }}) // Update state in DB
        return { statusCode: 200, body: JSON.stringify(insertResult), }
}


exports.handler = async (event: any, context: any) => {
    // TODO implement
    console.log("EVENT: \n" + JSON.stringify(event, null, 2))
    let bucket = event.bucket;
    let fileKey = event.fileKey;
    let resetDb = event.resetDb;
    let response = await deployDataToDB(pool, bucket, fileKey, resetDb)
    // console.log("EVENT: \n" + JSON.stringify(context, null, 2))
    // const response = {
    //     statusCode: 200,
    //     body: JSON.stringify('Trying to deploy data to DB...'),
    // };
    return response;
};