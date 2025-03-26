import { dbService } from '../services/db.service.js'
import { logger } from '../services/logger.service.js'

export async function runMigration() {
  try {
    const collection = await dbService.getCollection('user')
    
    // עדכון כל המשתמשים שחסר להם השדה
    const result = await collection.updateMany(
      { homeLocation: { $exists: false } },
      { $set: { homeLocation: null } }
    )
    
    // יצירת אינדקס גיאו-מרחבי (תמיד)
    await collection.createIndex(
      { "homeLocation": "2dsphere" },
      { sparse: true }
    )
    
    logger.info(`Migration completed - Updated ${result.modifiedCount} users`)
    return true
  } catch (err) {
    logger.error('Migration failed', err)
    throw err // נזרוק שגיאה כדי שהשרת לא יתחיל אם המיגרציה נכשלה
  }
}