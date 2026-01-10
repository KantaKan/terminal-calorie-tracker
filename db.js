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
    // Upsert seeding for Food collection
    const existingFoods = await Food.find({}, 'name').lean();
    const existingFoodNames = new Set(existingFoods.map(food => food.name));

    const newFoodsToSeed = seedFoods.filter(seedFood => !existingFoodNames.has(seedFood.name));

    if (newFoodsToSeed.length > 0) {
      console.log(`Found ${newFoodsToSeed.length} new food items to seed. Seeding data...`);
      await Food.insertMany(newFoodsToSeed);
      console.log('New food data seeded successfully.');
    } else {
      console.log('Food database is up to date.');
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
