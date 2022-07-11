import { dbHandlerClass } from './databaseHandler';
import type { Pool, PoolClient } from 'pg';
// require('dotenv').config();  // Not used anymore **DEBUG ONLY**

/* —————————————————————- SEED DATABASE QUESRIES  ——————————————————— */
let queryStringDrop = `DROP TABLE IF EXISTS  $tableName;`;
let queryStringDropState = `DROP TABLE IF EXISTS system_states;`;
let postgresFunction = `CREATE OR REPLACE FUNCTION trigger_set_timestamp() RETURNS TRIGGER AS $$
                        BEGIN
                            NEW.updated_at = NOW();
                            RETURN NEW;
                        END;
                        $$ LANGUAGE plpgsql;`;
let dropTrigger = `DROP TRIGGER IF EXISTS set_timestamp ON $tableName;`
let dropStateTrigger = `DROP TRIGGER IF EXISTS set_timestamp ON system_states;`
let createTrigger = `CREATE TRIGGER set_timestamp
                    BEFORE UPDATE ON $tableName
                    FOR EACH ROW
                    EXECUTE PROCEDURE trigger_set_timestamp();`;
let queryStringCreateStateTable = `CREATE TABLE IF NOT EXISTS system_states (
                    id SERIAL PRIMARY KEY 
                    , created_at TIMESTAMPTZ NOT NULL DEFAULT NOW() 
                    , updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() 
                    ,	state_id VARCHAR(128) UNIQUE
                    ,	state_name VARCHAR(128)
                    ,	source VARCHAR(128)
                    ,	parameters JSON
                    ,   spare_field VARCHAR(128)
                    ,   note VARCHAR(512)
                    );`
let createStateTrigger = `CREATE TRIGGER set_timestamp
                    BEFORE UPDATE ON system_states
                    FOR EACH ROW
                    EXECUTE PROCEDURE trigger_set_timestamp();`;    

let queryStringCreateMainTable = `CREATE TABLE IF NOT EXISTS $tableName (
                id SERIAL PRIMARY KEY \
                , created_at TIMESTAMPTZ NOT NULL DEFAULT NOW() 
                , updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() 
                ,	fips VARCHAR(8)
                ,	apn VARCHAR(32)
                ,	street_number VARCHAR(128)
                ,	street_pre_direction VARCHAR(16)
                ,	street_name VARCHAR(256)
                ,	street_suffix VARCHAR(32)
                ,	street_post_direction VARCHAR(32)
                ,	unit_type VARCHAR(32)
                ,	unit_number VARCHAR(64)
                ,	formatted_street_address VARCHAR(256)
                ,	city VARCHAR(128)
                ,	state VARCHAR(8)
                ,	zip_code VARCHAR(6)
                ,	zip_plus_four_code VARCHAR(24)
                ,	latitude VARCHAR(32)
                ,	longitude VARCHAR(32)
                ,	geocoding_accuracy VARCHAR(32)
                ,	census_tract VARCHAR(32)
                ,	carrier_code VARCHAR(32)
                                );`;


export async function seedDatabase(pool: Pool | PoolClient, tableName: string, resetDb: boolean): Promise<string> {
    /* Creates Database  */
        console.log(`☀️ CREATE TABLE: "${tableName}"`)  // ** Sanity check **
        if (resetDb) {
            // If DROP is enabled in .ENV file
            for (let _queryStringDrop of [queryStringDrop, queryStringDropState]) {
                _queryStringDrop = _queryStringDrop.replace("$tableName", tableName);
                console.log(`DROP DB Q:${_queryStringDrop} — DB:${tableName}`); // ** Sanity check **
                let result = await dbHandlerClass.queryPool(pool, _queryStringDrop, []);
                console.log(`⚠️ DROP TABLE RESULT:>${result[0].toString()}`); }
        }
        // Create triggers and tables tables
        for (let _queryString of [postgresFunction, 
                                queryStringCreateStateTable,
                                queryStringCreateMainTable, 
                                dropTrigger, 
                                dropStateTrigger,
                                createStateTrigger,
                                createTrigger,
                                ]) {
            _queryString = _queryString.replace("$tableName", tableName);
            // console.log(`seed DB Q:${_queryString} on DB:${tableName}`);  // ** Sanity check **
            let result = await dbHandlerClass.queryPool(pool, _queryString, []);
            console.log(`🔗  ${result[0].toString()}`);
        }
    return "CREATED !";
    }