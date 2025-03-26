import { MongoClient } from 'mongodb'

import { config } from '../config/index.js'
import { logger } from './logger.service.js'

export const dbService = { getCollection,updateUserSchema }

var dbConn = null

async function getCollection(collectionName) {
	try {
		const db = await _connect()
		const collection = await db.collection(collectionName)
		return collection
	} catch (err) {
		logger.error('Failed to get Mongo collection', err)
		throw err
	}
}

// services/db.service.js
async function _connect() {
	if (dbConn) return dbConn
	
	const client = await MongoClient.connect(config.dbURL)
	dbConn = client.db(config.dbName)
	
	// וודא שהאינדקס קיים (רצה בכל חיבור אבל זה פעולה קלה)
	await dbConn.collection('user').createIndex(
	  { "homeLocation": "2dsphere" },
	  { sparse: true }
	)
	
	return dbConn
  }

async function updateUserSchema() {
	try {
	  const db = await _connect()
	  const result = await db.collection('user').updateMany(
		{ homeLocation: { $exists: false } },
		{ $set: { homeLocation: null } }
	  )
	  logger.info(`Updated ${result.modifiedCount} users with homeLocation field`)
	  return result
	} catch (err) {
	  logger.error('Failed to update user schema', err)
	  throw err
	}
  }