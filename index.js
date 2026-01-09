import dotenv from 'dotenv';
dotenv.config();
import inquirer from 'inquirer';
import chalk from 'chalk';
import boxen from 'boxen';
import Fuse from 'fuse.js';
import { connectDB, disconnectDB } from './db.js';
import { getLocalDate, getCurrentTime } from './utils.js';
import Log from './models/Log.js';
import Food from './models/Food.js';
import Config from './models/Config.js';
import inquirerAutocompletePrompt from 'inquirer-autocomplete-prompt';

const debounce = (func, timeout = 150) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { func.apply(this, args); }, timeout);
  };
};

inquirer.registerPrompt('autocomplete', inquirerAutocompletePrompt);

// In-memory cache for food data to make search instant
let foodCache = [];

let isRendering = false;

const run = async () => {
  // A simple lock to prevent concurrent renders from resize events
  if (isRendering) return;
  isRendering = true;

  try {
    // The main logic is now encapsulated in showDashboard
    await showDashboard();
  } catch (error) {
    if (error.isTtyError) {
      // Inquirer can throw this error if the environment is not a TTY.
      // This can happen during resize or if run in a non-interactive shell.
      // We can choose to ignore it or log it.
      console.log('Caught a TTY error, possibly from resizing. Ignoring.');
    } else {
      console.error('An unexpected error occurred:', error);
      await disconnectDB();
      process.exit(1);
    }
  } finally {
    isRendering = false;
  }
};


const showDashboard = async () => {
  process.stdout.write('\x1Bc'); // Clear console for better cross-platform compatibility
  const today = getLocalDate();
  
  const [log, config] = await Promise.all([
    Log.findOne({ date: today }),
    Config.findOne({ key: 'user_settings' })
  ]);

  const dailyGoal = config ? config.dailyGoal : 2000;
  const currentKcal = log ? log.totalKcal : 0;
  const remainingKcal = dailyGoal - currentKcal;
  const progress = Math.min(100, (currentKcal / dailyGoal) * 100);

  // --- UI Rendering ---
  const progressColor = progress >= 100 ? chalk.red : progress > 75 ? chalk.yellow : chalk.green;
  const progressBar = createProgressBar(progress, 20);

  let dashboardContent = '';
  dashboardContent += chalk.bold(`📅 Date: ${today}\n`);
  dashboardContent += `🔥 ${chalk.bold(currentKcal)} kcal / ${chalk.bold(dailyGoal)} kcal\n`;
  dashboardContent += `📊 Progress: [${progressColor(progressBar)}] ${progress.toFixed(1)}%\n`;
  dashboardContent += remainingKcal > 0 ? `✅ ${chalk.green.bold(remainingKcal)} kcal remaining` : `🚨 ${chalk.red.bold(Math.abs(remainingKcal))} kcal over goal`;
  
  if (log && log.entries.length > 0) {
    dashboardContent += `\n\n--- ${chalk.bold('Last 5 Meals')} ---\n`;
    log.entries.slice(-5).reverse().forEach(entry => {
      dashboardContent += `  - ${entry.name} (${chalk.yellow(entry.kcal)} kcal) at ${entry.time}\n`;
    });
  }

  console.log(boxen(dashboardContent, {
    padding: 1,
    margin: 1,
    borderStyle: 'round',
    title: 'CalTrack Terminal',
    titleAlignment: 'center',
  }));

  // --- Menu ---
  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: 'What would you like to do?',
      choices: [
        { name: '➕ Add Meal', value: 'add' },
        { name: '⚙️  Set Daily Goal', value: 'goal' },
        new inquirer.Separator(),
        { name: '❌ Exit', value: 'exit' },
      ],
    },
  ]);

  switch (choice) {
    case 'add':
      await addMeal();
      run(); // Continue the loop
      break;
    case 'goal':
      await setDailyGoal();
      run(); // Continue the loop
      break;
    case 'exit':
      await disconnectDB();
      process.exit(0);
  }
};

const createProgressBar = (percentage, length) => {
  const filledLength = Math.round((percentage / 100) * length);
  const emptyLength = length - filledLength;
  return '█'.repeat(filledLength) + '░'.repeat(emptyLength);
};

const addMeal = async () => {
  const fuse = new Fuse(foodCache, {
    keys: ['name'],
    includeScore: true,
    threshold: 0.4,
  });

  const { foodId } = await inquirer.prompt({
    type: 'autocomplete',
    name: 'foodId',
    message: 'Search for a food or select "Create New":',
    source: async (answersSoFar, input) => {
      input = input || '';
      const searchResults = fuse.search(input).map(result => ({
        name: `${result.item.name} (${result.item.kcal} kcal)`,
        value: result.item._id,
      }));
      
      return [
        { name: '➕ Create New Food', value: 'CREATE_NEW' },
        { name: '❌ Cancel', value: 'CANCEL' },
        new inquirer.Separator(),
        ...searchResults,
      ];
    },
  });

  if (foodId === 'CANCEL') {
    console.log(chalk.yellow('\nAction cancelled.'));
    return;
  }

  if (foodId === 'CREATE_NEW') {
    const answers = await inquirer.prompt([
      { type: 'input', name: 'name', message: 'Food name:', validate: input => input.length > 0 || 'Please enter a name.' },
      { 
        type: 'input', 
        name: 'kcalStr', 
        message: 'Calories (kcal):', 
        validate: input => {
          const kcal = parseFloat(input);
          return !isNaN(kcal) && kcal >= 0 || 'Please enter a valid number for calories.';
        }
      },
    ]);
    const name = answers.name;
    const kcal = parseFloat(answers.kcalStr);
    
    try {
      const newFood = new Food({ name, kcal });
      const savedFood = await newFood.save();
      foodCache.push(savedFood); // Update cache
      await logMeal(savedFood);
      console.log(chalk.green(`\n✅ Learned and added "${name}"!`));
    } catch (error) {
      if (error.code === 11000) { // Duplicate key error
        console.log(chalk.red(`\nError: A food named "${name}" already exists.`));
      } else {
        console.log(chalk.red(`\nError saving new food: ${error.message}`));
      }
      await inquirer.prompt({ type: 'input', name: 'ack', message: 'Press Enter to continue...' });
    }
  } else {
    const selectedFood = foodCache.find(f => f._id.equals(foodId));
    if (selectedFood) {
      await logMeal(selectedFood);
      console.log(chalk.green(`\n✅ Added "${selectedFood.name}"!`));
    }
  }
};

const logMeal = async (food) => {
  const today = getLocalDate();
  const time = getCurrentTime();

  await Log.findOneAndUpdate(
    { date: today },
    {
      $push: { entries: { name: food.name, kcal: food.kcal, time } },
      $inc: { totalKcal: food.kcal },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const setDailyGoal = async () => {
  const { newGoalStr } = await inquirer.prompt([
    {
      type: 'input',
      name: 'newGoalStr',
      message: 'Enter your new daily calorie goal:',
      validate: input => {
        const goal = parseFloat(input);
        return !isNaN(goal) && goal > 0 || 'Please enter a valid positive number.';
      }
    },
  ]);
  const newGoal = parseFloat(newGoalStr);
  await Config.findOneAndUpdate({ key: 'user_settings' }, { dailyGoal: newGoal });
  console.log(chalk.green(`\nGoal updated to ${newGoal} kcal!`));
};

// --- Main Execution ---
(async () => {
    const loadFoodCache = async () => {
        try {
            foodCache = await Food.find({});
            console.log(`\n${foodCache.length} food items loaded into memory for searching.`);
        } catch (err) {
            console.error('Failed to load food cache:', err.message);
        }
    }

    await connectDB();
    await loadFoodCache();

    // When the terminal is resized, debounce the event and re-run the main function.
    process.stdout.on('resize', debounce(run, 200));

    // Initial run
    run();
})();
