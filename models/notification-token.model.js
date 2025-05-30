import mongoose from 'mongoose'

const notificationTokenSchema = new mongoose.Schema({
    token: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
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
        default: 'active',
        index: true
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

export const NotificationToken = mongoose.model('NotificationToken', notificationTokenSchema) 