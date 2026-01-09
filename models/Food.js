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
});

export default mongoose.model('Food', FoodSchema);
