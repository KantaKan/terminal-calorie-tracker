import dotenv from 'dotenv';
dotenv.config();
import inquirer from 'inquirer';
import chalk from 'chalk';
import boxen from 'boxen';
import Fuse from 'fuse.js';
import { connectDB, disconnectDB } from './db.js';
import { getLocalDate, getCurrentTime, getTimeSlot } from './utils.js';
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

const main = async () => {
  await connectDB();

  const loadFoodCache = async () => {
    try {
        foodCache = await Food.find({});
        console.log(`\n${foodCache.length} food items loaded into memory for searching.`);
    } catch (err) {
        console.error('Failed to load food cache:', err.message);
    }
  }
  await loadFoodCache();

  // The main application loop. A simple while(true) is more stable.
  while (true) {
    try {
      await showDashboard();
    } catch (error) {
      console.error("An unexpected error occurred in the main loop:", error);
      // Optional: add a small delay or a prompt before continuing to prevent rapid-fire errors.
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
};

const showDashboard = async () => {
  process.stdout.write('\x1Bc'); // Clear console
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
      dashboardContent += `  - (${chalk.cyan(entry.timeSlot)}) ${entry.name} (${chalk.yellow(entry.kcal)} kcal) at ${entry.time}\n`;
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
        { name: '📖 View History', value: 'history' },
        { name: '⚙️  Set Daily Goal', value: 'goal' },
        { name: '🔄 Refresh Dashboard', value: 'refresh' },
        new inquirer.Separator(),
        { name: '❌ Exit', value: 'exit' },
      ],
    },
  ]);

  switch (choice) {
    case 'add':
      await addMeal();
      break;
    case 'history':
      await viewHistory();
      break;
    case 'goal':
      await setDailyGoal();
      break;
    case 'refresh':
      // Simply breaking will cause the while loop to restart and redraw the UI.
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
  let foodToAdd = null;

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
      const { name } = await inquirer.prompt([
        { 
          type: 'input', 
          name: 'name', 
          message: 'Enter food name (or type "cancel" to go back):',
          validate: input => input.length > 0 || 'Please enter a name.'
        }
      ]);
  
      if (name.toLowerCase() === 'cancel') {
          console.log(chalk.yellow('\nCreation cancelled.'));
          return;
      }
  
      const { kcalStr } = await inquirer.prompt([
        { 
          type: 'input', 
          name: 'kcalStr', 
          message: `Calories (kcal) for "${name}":`,
          validate: input => {
            const kcal = parseFloat(input);
            return !isNaN(kcal) && kcal >= 0 || 'Please enter a valid number for calories.';
          }
        },
      ]);
  
      const kcal = parseFloat(kcalStr);
      
      try {
        const newFood = new Food({ name, kcal });
        foodToAdd = await newFood.save();
        foodCache.push(foodToAdd); // Update cache
        console.log(chalk.green(`\n✅ Learned "${name}"!`));
      } catch (error) {
        if (error.code === 11000) { // Duplicate key error
          console.log(chalk.red(`\nError: A food named "${name}" already exists.`));
        } else {
          console.log(chalk.red(`\nError saving new food: ${error.message}`));
        }
        await inquirer.prompt({ type: 'input', name: 'ack', message: 'Press Enter to continue...' });
        return; // Return to main menu on error
      }
    } else {
      foodToAdd = foodCache.find(f => f._id.equals(foodId));
    }
  if (foodToAdd) {
    // --- Prompt for Time Slot ---
    const { slot } = await inquirer.prompt([
        {
            type: 'list',
            name: 'slot',
            message: 'Which time slot for this meal?',
            choices: ['Auto', 'Morning', 'Afternoon', 'Evening', 'Night'],
            default: 'Auto',
        }
    ]);
    
    const timeSlot = slot === 'Auto' ? getTimeSlot() : slot;

    await logMeal(foodToAdd, timeSlot);
    console.log(chalk.green(`\n✅ Added "${foodToAdd.name}" to ${timeSlot}!`));
  }
};

const logMeal = async (food, timeSlot) => {
  const today = getLocalDate();
  const time = getCurrentTime();

  await Log.findOneAndUpdate(
    { date: today },
    {
      $push: { entries: { name: food.name, kcal: food.kcal, time, timeSlot } },
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

const viewHistory = async () => {
    console.clear();
    const logs = await Log.find({}).sort({ date: -1 });
    const config = await Config.findOne({ key: 'user_settings' });
    const dailyGoal = config ? config.dailyGoal : 2000;

    if (logs.length === 0) {
        console.log(chalk.yellow('No history found.'));
        await inquirer.prompt({ type: 'input', name: 'ack', message: 'Press Enter to continue...' });
        return;
    }

    const { date_to_view } = await inquirer.prompt([
        {
            type: 'list',
            name: 'date_to_view',
            message: 'Select a day to view:',
            choices: [
                ...logs.map(log => {
                    const progress = (log.totalKcal / dailyGoal) * 100;
                    const color = progress >= 100 ? chalk.red : progress > 75 ? chalk.yellow : chalk.green;
                    return {
                        name: color(`${log.date}  -  ${log.totalKcal} / ${dailyGoal} kcal`),
                        value: log.date,
                    }
                }),
                new inquirer.Separator(),
                { name: '⬅️  Go Back', value: 'BACK' }
            ],
            loop: false,
        }
    ]);

    if (date_to_view !== 'BACK') {
        await showDayDetail(date_to_view);
    }
};

const showDayDetail = async (dateString) => {
    let stayOnPage = true;
    while(stayOnPage) {
        console.clear();
        const log = await Log.findOne({ date: dateString });
        
        if (!log) {
            console.log(chalk.yellow('Log for this day no longer exists.'));
            await inquirer.prompt({ type: 'input', name: 'ack', message: 'Press Enter to continue...' });
            stayOnPage = false;
            break;
        }

        const config = await Config.findOne({ key: 'user_settings' });
        const dailyGoal = config ? config.dailyGoal : 2000;
        const progress = (log.totalKcal / dailyGoal) * 100;
        const progressColor = progress >= 100 ? chalk.red : progress > 75 ? chalk.yellow : chalk.green;
        const progressBar = createProgressBar(progress, 20);

        let detailContent = '';
        detailContent += chalk.bold(`📅 Date: ${log.date}\n`);
        detailContent += `🔥 ${chalk.bold(log.totalKcal)} kcal / ${chalk.bold(dailyGoal)} kcal\n`;
        detailContent += `📊 Progress: [${progressColor(progressBar)}] ${progress.toFixed(1)}%\n\n`;
        detailContent += `--- ${chalk.bold('All Meals')} ---\n`;

        log.entries.forEach((entry, index) => {
            detailContent += `  ${chalk.grey(index + 1 + '.')} (${chalk.cyan(entry.timeSlot)}) ${entry.name} (${chalk.yellow(entry.kcal)} kcal) at ${entry.time}\n`;
        });

        console.log(boxen(detailContent, {
            padding: 1,
            margin: 1,
            borderStyle: 'round',
            title: 'Daily Log Details',
            titleAlignment: 'center',
        }));

        const { choice } = await inquirer.prompt([{
            type: 'list',
            name: 'choice',
            message: 'What would you like to do?',
            choices: [
                { name: '✏️  Edit an Entry', value: 'edit' },
                { name: '🗑️  Delete an Entry', value: 'delete' },
                new inquirer.Separator(),
                { name: '⬅️  Go Back to History', value: 'back' },
            ]
        }]);

        switch(choice) {
            case 'edit':
                await editEntry(log);
                break;
            case 'delete':
                await deleteEntry(log);
                break;
            case 'back':
                stayOnPage = false;
                break;
        }
    }
};

const editEntry = async (log) => {
    if (log.entries.length === 0) {
        console.log(chalk.yellow('\nThere are no entries to edit.'));
        await inquirer.prompt({ type: 'input', name: 'ack', message: 'Press Enter to continue...' });
        return;
    }

    const { entryIdToEdit } = await inquirer.prompt([{
        type: 'list',
        name: 'entryIdToEdit',
        message: 'Which entry would you like to edit?',
        choices: [
            ...log.entries.map((entry, index) => ({
                name: `${index + 1}. (${entry.timeSlot}) ${entry.name} (${entry.kcal} kcal)`,
                value: entry._id,
            })),
            new inquirer.Separator(),
            { name: 'Cancel', value: 'CANCEL' },
        ],
        loop: false,
    }]);

    if (entryIdToEdit === 'CANCEL') {
        return;
    }

    const entryToEdit = log.entries.find(e => e._id.equals(entryIdToEdit));
    if (!entryToEdit) return;

    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'newName',
            message: 'Enter the new name:',
            default: entryToEdit.name,
        },
        {
            type: 'input',
            name: 'newKcalStr',
            message: 'Enter the new calories:',
            default: entryToEdit.kcal,
            validate: input => {
                const kcal = parseFloat(input);
                return !isNaN(kcal) && kcal >= 0 || 'Please enter a valid number for calories.';
            }
        }
    ]);

    const newName = answers.newName;
    const newKcal = parseFloat(answers.newKcalStr);
    const kcalDifference = newKcal - entryToEdit.kcal;

    await Log.updateOne(
        { _id: log._id },
        {
            $set: {
                "entries.$[elem].name": newName,
                "entries.$[elem].kcal": newKcal,
            },
            $inc: { totalKcal: kcalDifference }
        },
        {
            arrayFilters: [{ "elem._id": entryIdToEdit }]
        }
    );
    
    console.log(chalk.green('\nEntry successfully updated.'));
    await inquirer.prompt({ type: 'input', name: 'ack', message: 'Press Enter to continue...' });
};

const deleteEntry = async (log) => {
    if (log.entries.length === 0) {
        console.log(chalk.yellow('\nThere are no entries to delete.'));
        await inquirer.prompt({ type: 'input', name: 'ack', message: 'Press Enter to continue...' });
        return;
    }

    const { entryIdToDelete } = await inquirer.prompt([{
        type: 'list',
        name: 'entryIdToDelete',
        message: 'Which entry would you like to delete?',
        choices: [
            ...log.entries.map((entry, index) => ({
                name: `${index + 1}. (${entry.timeSlot}) ${entry.name} (${entry.kcal} kcal)`,
                value: entry._id,
            })),
            new inquirer.Separator(),
            { name: 'Cancel', value: 'CANCEL' },
        ],
        loop: false,
    }]);

    if (entryIdToDelete === 'CANCEL') {
        return;
    }

    const { confirmDelete } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirmDelete',
        message: 'Are you sure you want to delete this entry?',
        default: false,
    }]);

    if (confirmDelete) {
        const entryToDelete = log.entries.find(e => e._id.equals(entryIdToDelete));
        if (entryToDelete) {
            await Log.updateOne(
                { _id: log._id },
                {
                    $pull: { entries: { _id: entryIdToDelete } },
                    $inc: { totalKcal: -entryToDelete.kcal }
                }
            );
            console.log(chalk.green('\nEntry successfully deleted.'));
            await inquirer.prompt({ type: 'input', name: 'ack', message: 'Press Enter to continue...' });
        }
    }
};

main();
