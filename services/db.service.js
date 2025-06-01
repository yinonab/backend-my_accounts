import { MongoClient } from 'mongodb'
import config from '../config/dev.js'
import { logger } from './logger.service.js'

export const dbService = { getCollection, closeConnection }

var dbConn = null
const MAX_RETRIES = 3
const RETRY_DELAY = 2000 // 2 seconds
const CONNECTION_TIMEOUT = 60000 // 60 seconds

async function getCollection(collectionName) {
	let retries = 0
	while (retries < MAX_RETRIES) {
		try {
			const db = await _connect()
			const collection = await db.collection(collectionName)
			return collection
		} catch (err) {
			retries++
			logger.error(`Failed to get Mongo collection (attempt ${retries}/${MAX_RETRIES})`, err)
			
			if (retries === MAX_RETRIES) {
				throw err
			}
			
			// המתנה לפני ניסיון חוזר
			await new Promise(resolve => setTimeout(resolve, RETRY_DELAY))
		}
	}
}

async function _connect() {
	if (dbConn) {
		try {
			// בדיקה שהחיבור עדיין פעיל
			await dbConn.command({ ping: 1 })
			return dbConn
		} catch (err) {
			logger.warn('Database connection lost, reconnecting...')
			dbConn = null
		}
	}
	
	try {
		const client = await MongoClient.connect(config.dbURL, {
			serverSelectionTimeoutMS: 60000,
			socketTimeoutMS: 60000,
			connectTimeoutMS: 60000,
			maxPoolSize: 100,
			minPoolSize: 20,
			maxIdleTimeMS: 30000,
			retryWrites: true,
			retryReads: true
		})

		// הגדרת event listeners
		client.on('error', (err) => {
			logger.error('MongoDB connection error:', err)
			dbConn = null
		})

		client.on('close', () => {
			logger.warn('MongoDB connection closed')
			dbConn = null
		})

		client.on('reconnect', () => {
			logger.info('MongoDB reconnected')
		})

		return dbConn = client.db(config.dbName)
	} catch (err) {
		logger.error('Cannot Connect to DB', err)
		throw err
	}
}

async function closeConnection() {
	if (dbConn) {
		try {
			await dbConn.client.close()
			dbConn = null
			logger.info('Database connection closed')
		} catch (err) {
			logger.error('Error closing database connection:', err)
		}
	}
}

// ניקוי חיבור בעת סגירת האפליקציה
process.on('SIGINT', async () => {
	await closeConnection()
	process.exit(0)
})

process.on('SIGTERM', async () => {
	await closeConnection()
	process.exit(0)
})