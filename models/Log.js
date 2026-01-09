import mongoose from 'mongoose';

const LogSchema = new mongoose.Schema({
  date: {
    type: String, // Format "YYYY-MM-DD"
    required: true,
    unique: true,
  },
  entries: [
    {
      name: { type: String, required: true },
      kcal: { type: Number, required: true },
      time: { type: String, required: true }, // Format "HH:mm"
      timeSlot: { type: String, required: true },
    },
  ],
  totalKcal: {
    type: Number,
    required: true,
    default: 0,
  },
});

export default mongoose.model('Log', LogSchema);
