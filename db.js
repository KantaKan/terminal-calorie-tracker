import mongoose from 'mongoose';
import Food from './models/Food.js';
import Config from './models/Config.js';
import seedFoods from './data/foods.js';

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected...');
    await seedDatabase();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
};

const seedDatabase = async () => {
  try {
    // Seed Food collection
    const foodCount = await Food.countDocuments();
    if (foodCount === 0) {
      console.log('Food collection is empty. Seeding data...');
      await Food.insertMany(seedFoods);
      console.log('Food data seeded successfully.');
    }

    // Ensure default config exists
    const config = await Config.findOne({ key: 'user_settings' });
    if (!config) {
      console.log('Default config not found. Creating one...');
      await Config.create({
        key: 'user_settings',
        dailyGoal: 2000,
      });
      console.log('Default config created.');
    }
  } catch (err) {
    console.error('Error seeding database:', err.message);
  }
};

const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    console.log('MongoDB Disconnected.');
  } catch (err) {
    console.error('Error disconnecting from MongoDB:', err.message);
  }
};

export { connectDB, disconnectDB };
