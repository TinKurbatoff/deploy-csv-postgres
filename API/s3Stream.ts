import {Readable, ReadableOptions} from 'stream';
import { EventEmitter, Abortable } from 'node:events';
import type {S3} from 'aws-sdk';

export class SmartStream extends Readable {
    _currentCursorPosition = 0; // Holds the current starting position for our range queries
    _s3DataRange = 32 * 1024 * 1024; // Amount of bytes to grab
    _maxContentLength: number; // Total number of bites in the file
    _s3: S3; // AWS.S3 instance
    _s3StreamParams: S3.GetObjectRequest; // Parameters passed into s3.getObject method
    _adjustedRange = 0 // How many bytes read
    
    constructor(
        parameters: S3.GetObjectRequest,
        s3: S3,
        maxLength: number,
        chunkSize: number,
        // You can pass any ReadableStream options to the NodeJS Readable super class here
        // For this example we wont use this, however I left it in to be more robust
        nodeReadableStreamOptions?: ReadableOptions
    ) {
        super(nodeReadableStreamOptions);
        this._maxContentLength = maxLength;
        this._s3 = s3;
        this._s3StreamParams = parameters;
        this._s3DataRange = chunkSize * 1024 * 1024;
    }

    progress(adjustedRange: number) {
        console.log(`${(adjustedRange / 1024 / 1024).toFixed(4)} MB read...`)
        this.emit('progress', adjustedRange)
    }

    _read() {
        if (this._currentCursorPosition > this._maxContentLength) {
            // If the current position is greater than the amount of bytes in the file
            // We push null into the buffer, NodeJS ReadableStream will see this as the end of file (EOF) and emit the 'end' event
            this.push(null);
        } else {
            // Calculate the range of bytes we want to grab
            const range = this._currentCursorPosition + this._s3DataRange;
            // If the range is greater than the total number of bytes in the file
            // We adjust the range to grab the remaining bytes of data
            this._adjustedRange = range < this._maxContentLength ? range : this._maxContentLength;
            // Set the Range property on our s3 stream parameters
            this._s3StreamParams.Range = `bytes=${this._currentCursorPosition}-${this._adjustedRange}`;
            // Update the current range beginning for the next go 
            this._currentCursorPosition = this._adjustedRange + 1;
            // Grab the range of bytes from the file
            this._s3.getObject(this._s3StreamParams, (error, data) => {
                if (error) {
                    // If we encounter an error grabbing the bytes
                    // We destroy the stream, NodeJS ReadableStream will emit the 'error' event
                    this.destroy(error);
                } else {
                    // console.log(`${(this._adjustedRange / 1024 / 1024).toFixed(4)} MB read...`)
                    // We push the data into the stream buffer
                    this.progress(this._adjustedRange) // emit progress info
                    this.push(data.Body);
                }
            });
        }
    }
}


// CLASS S3 stream
export async function createAWSStream(s3: any, bucket: string, fileKey: string, chunkSize: number): Promise<SmartStream> {
    return new Promise((resolve, reject) => {
        const bucketParams = {
            Bucket: bucket,
            Key: fileKey
        }

        try {
            s3.headObject(bucketParams, (error: any, data: any) => {
                if (error) {
                    console.log(bucketParams, `${error?.code} (${error?.statusCode})` )
                    throw error;
                }
                // After getting the data we want from the call to s3.headObject
                // We have everything we need to instantiate our SmartStream class
                // If you want to pass ReadableOptions to the Readable class, you pass the object as the fourth parameter
                const stream = new SmartStream(bucketParams, s3, data.ContentLength, chunkSize);

                resolve(stream);
            });
        } catch (error) {
            reject(error)
        }
    });
}
