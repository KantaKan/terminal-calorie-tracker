import mongoose from 'mongoose';

const ConfigSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    default: 'user_settings',
  },
  dailyGoal: {
    type: Number,
    required: true,
    default: 2000,
  },
});

export default mongoose.model('Config', ConfigSchema);
