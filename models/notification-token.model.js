import mongoose from 'mongoose'

const notificationTokenSchema = new mongoose.Schema({
    token: {
        type: String,
        required: true,
        unique: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    platform: {
        type: String,
        enum: ['web', 'android', 'ios'],
        default: 'web'
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastUsed: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['active', 'inactive', 'expired'],
        default: 'active'
    },
    metadata: {
        deviceInfo: {
            type: Object,
            default: {}
        },
        appVersion: {
            type: String,
            default: '1.0.0'
        }
    }
}, {
    timestamps: true
})

// אינדקסים לשיפור ביצועים
notificationTokenSchema.index({ token: 1 })
notificationTokenSchema.index({ userId: 1 })
notificationTokenSchema.index({ status: 1 })

export const NotificationToken = mongoose.model('NotificationToken', notificationTokenSchema) 