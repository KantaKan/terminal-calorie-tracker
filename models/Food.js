import mongoose from 'mongoose';

const FoodSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  kcal: {
    type: Number,
    required: true,
  },
  protein: {
    type: Number,
    default: 0,
  },
  carbs: {
    type: Number,
    default: 0,
  },
  fat: {
    type: Number,
    default: 0,
  },
  category: {
    type: String,
    enum: ['protein-heavy', 'carb-heavy', 'fat-heavy', 'mixed'],
    default: 'mixed',
  },
});

export default mongoose.model('Food', FoodSchema);
