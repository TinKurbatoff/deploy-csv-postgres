import type { Pool, PoolClient, QueryResult, ResultBuilder } from 'pg';
const pg = require('pg');
var dotenv = require('dotenv');
dotenv.config();

console.log(`ENVIRONMENT:${process.env.ENVIRONMENT}`);
console.log(`RDS_USERNAME:${process.env.RDS_USERNAME}`);
console.log(`RDS_DATABASE:${process.env.RDS_DATABASE}`);

export const pool = new pg.Pool({ // Let use Pooling now
  // In production I will use environment variables
  user: process.env.RDS_USERNAME,
  password: process.env.RDS_PASSWORD,
  database: process.env.RDS_DATABASE,
  port: process.env.RDS_PORT,
  host: process.env.RDS_HOSTNAME,
  ssl: process.env.DB_SSL === "True"? { rejectUnauthorized: false } : false,
});

// if a backend error or network problem happens
pool.on('error', (err: Error, client: PoolClient): void => {
  console.error('Unexpected error on idle client', err) // just report to console
  process.exit(-1)
}) 

// Connect to pool
pool.connect()

/* Class with static method to query database */
export class dbHandlerClass {
  /*  Class handles connection to a database and returns rows */
  static async queryPool(conn: Pool | PoolClient, queryString:string, params: Array<string>): Promise<Array<Object>> {
      return conn.query(queryString, params)
      .then( (res: QueryResult<any>) => {
          // console.log(res.command)
          // console.debug(`📬  Executed action ${queryString} OKAY.`)
          return res.rows.length? res.rows : [res.command];
          })
      .catch((err: { message: any; }) => {
          console.log(err.message)
          console.log(`⛔️  Query failed: ${queryString} | PARAMS:${params}`)
          // throw err;
          // console.log(err.stack)    
          return [`ERROR:${err.message}`];
          })        
  }
}

// module.exports = dbHandlerClass