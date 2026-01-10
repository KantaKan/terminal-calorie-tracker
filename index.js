import dotenv from 'dotenv';
dotenv.config();
import inquirer from 'inquirer';
import chalk from 'chalk';
import Fuse from 'fuse.js';
import { connectDB, disconnectDB } from './db.js';
import { getLocalDate, getCurrentTime, getTimeSlot } from './utils.js';
import Log from './models/Log.js';
import Food from './models/Food.js';
import Config from './models/Config.js';
import Table from 'cli-table3';
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

  // --- UI Rendering with cli-table3 ---
  const progressColor = progress >= 100 ? chalk.red : progress > 75 ? chalk.yellow : chalk.green;
  const progressBar = createProgressBar(progress, 20);

  // Main container table that mimics boxen
  const table = new Table({
    chars: { 'top': '─' , 'top-mid': '┬' , 'top-left': '╭' , 'top-right': '╮'
           , 'bottom': '─' , 'bottom-mid': '┴' , 'bottom-left': '╰' , 'bottom-right': '╯'
           , 'left': '│' , 'left-mid': '├' , 'mid': '─' , 'mid-mid': '┼'
           , 'right': '│' , 'right-mid': '┤' , 'middle': '│' },
    style: { 'padding-left': 1, 'padding-right': 1, border: [], head: [] },
  });

  // Title Row
  table.push(
    [{ 
      content: chalk.bold('CalTrack Terminal'), 
      colSpan: 2, 
      hAlign: 'center' 
    }]
  );
  
  // Content Row
  let statsContent = '';
  statsContent += chalk.bold(`📅 Date: ${today}\n`);
  statsContent += `🔥 ${chalk.bold(currentKcal)} kcal / ${chalk.bold(dailyGoal)} kcal\n`;
  statsContent += `📊 Progress: [${progressColor(progressBar)}] ${progress.toFixed(1)}%\n`;
  statsContent += remainingKcal > 0 ? `✅ ${chalk.green.bold(remainingKcal)} kcal remaining` : `🚨 ${chalk.red.bold(Math.abs(remainingKcal))} kcal over goal`;
  
  let mealsContent = `--- ${chalk.bold('Last 5 Meals')} ---\n`;
  if (log && log.entries.length > 0) {
    log.entries.slice(-5).reverse().forEach(entry => {
      mealsContent += `  - (${chalk.cyan(entry.timeSlot)}) ${entry.name} (${chalk.yellow(entry.kcal)} kcal)\n`;
    });
  } else {
    mealsContent += chalk.gray('  No meals logged yet today.');
  }

  table.push([
    { content: statsContent, vAlign: 'center' },
    { content: mealsContent, vAlign: 'center' }
  ]);

  console.log(table.toString());

  // --- Menu ---
  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: 'What would you like to do?',
      choices: [
        { name: '➕ Add Meal', value: 'add' },
        { name: '📖 View History', value: 'history' },
        { name: '📊 Weekly Report', value: 'report' },
        { name: '🥑 Food Management', value: 'food' },
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
    case 'report':
      await showWeeklyReport();
      break;
    case 'food':
      await manageFoods();
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

const showWeeklyReport = async () => {
    console.clear();
    console.log(chalk.bold.cyan('\n--- 📊 Weekly Report ---'));

    const today = new Date();
    const weekDates = [];
    const weekData = new Map();

    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(today.getDate() - i);
        const dateString = date.toLocaleDateString('en-CA');
        weekDates.push(dateString);
        weekData.set(dateString, 0);
    }

    const startDate = weekDates[0];
    const logs = await Log.find({ date: { $gte: startDate } });

    logs.forEach(log => {
        if (weekData.has(log.date)) {
            weekData.set(log.date, log.totalKcal);
        }
    });

    const weeklyTotal = logs.reduce((sum, log) => sum + log.totalKcal, 0);
    const weeklyAverage = logs.length > 0 ? weeklyTotal / logs.length : 0;

    console.log(`\n${chalk.bold('Weekly Summary:')}`);
    console.log(`  - Total Calories: ${chalk.yellow(weeklyTotal.toFixed(0))} kcal`);
    console.log(`  - Average Daily Calories: ${chalk.yellow(weeklyAverage.toFixed(0))} kcal\n`);

    const chartTable = new Table({
        head: [chalk.bold('Date'), chalk.bold('Calories'), ''],
        colWidths: [15, 30, 10],
    });

    const maxKcal = Math.max(...weekData.values(), 1);

    for (const date of weekDates) {
        const kcal = weekData.get(date);
        const barLength = Math.round((kcal / maxKcal) * 25);
        const bar = '█'.repeat(barLength);
        chartTable.push([
            date,
            bar,
            chalk.yellow(`${kcal} kcal`)
        ]);
    }

    console.log(chartTable.toString());

    await inquirer.prompt({ type: 'input', name: 'ack', message: '\nPress Enter to continue...' });
};

const createProgressBar = (percentage, length) => {
  const filledLength = Math.round((percentage / 100) * length);
  const emptyLength = length - filledLength;
  return '█'.repeat(filledLength) + '░'.repeat(emptyLength);
};

const createNewFood = async () => {
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
        return null;
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
      const savedFood = await newFood.save();
      foodCache.push(savedFood); // Update cache
      console.log(chalk.green(`\n✅ Learned "${name}"!`));
      return savedFood;
    } catch (error) {
      if (error.code === 11000) { // Duplicate key error
        console.log(chalk.red(`\nError: A food named "${name}" already exists.`));
      } else {
        console.log(chalk.red(`\nError saving new food: ${error.message}`));
      }
      await inquirer.prompt({ type: 'input', name: 'ack', message: 'Press Enter to continue...' });
      return null; // Return null on error
    }
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
    foodToAdd = await createNewFood();
    if (!foodToAdd) return; // If creation was cancelled or failed, stop.
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
                    const totalKcalStr = String(log.totalKcal).padStart(5);
                    return {
                        name: color(`${log.date}  -  ${totalKcalStr} / ${dailyGoal} kcal`),
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
        const progressBar = createProgressBar(progress, 2.0);

        // --- Header ---
        let summaryContent = '';
        summaryContent += chalk.bold(`📅 Daily Log for: ${log.date}\n`);
        summaryContent += `🔥 ${chalk.bold(log.totalKcal)} kcal / ${chalk.bold(dailyGoal)} kcal\n`;
        summaryContent += `📊 Progress: [${progressColor(progressBar)}] ${progress.toFixed(1)}%\n`;
        console.log(summaryContent);
        
        // --- Meals Table ---
        const mealsTable = new Table({
            head: [
                chalk.bold('#'), 
                chalk.bold('Time Slot'), 
                chalk.bold('Name'), 
                chalk.bold('Kcal'), 
                chalk.bold('Time')
            ],
            colWidths: [5, 12, 30, 10, 10],
            style: { head: ['cyan'] }
        });

        log.entries.forEach((entry, index) => {
            mealsTable.push([
                index + 1,
                entry.timeSlot,
                entry.name,
                chalk.yellow(entry.kcal),
                entry.time,
            ]);
        });

        console.log(mealsTable.toString());

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

const manageFoods = async () => {
    let stay = true;
    while(stay) {
        console.clear();
        const { choice } = await inquirer.prompt([{
            type: 'list',
            name: 'choice',
            message: '🥑 Food Management',
            choices: [
                { name: '📄 List All Foods', value: 'list' },
                { name: '➕ Add a New Food', value: 'add' },
                { name: '✏️  Edit a Food', value: 'edit' },
                { name: '🗑️  Delete a Food', value: 'delete' },
                new inquirer.Separator(),
                { name: '⬅️  Go Back', value: 'back' },
            ]
        }]);

        switch(choice) {
            case 'list':
                await listFoods();
                break;
            case 'add':
                await addFood();
                break;
            case 'edit':
                await editFood();
                break;
            case 'delete':
                await deleteFood();
                break;
            case 'back':
                stay = false;
                break;
        }
    }
}

const listFoods = async () => { 
    console.clear();
    const table = new Table({
        head: [chalk.bold('Name'), chalk.bold('Calories (kcal)')],
        colWidths: [40, 20],
    });

    // Sort food by name alphabetically
    const sortedFood = [...foodCache].sort((a, b) => a.name.localeCompare(b.name));

    sortedFood.forEach(food => {
        table.push([food.name, chalk.yellow(food.kcal)]);
    });

    console.log(chalk.bold.cyan('\n--- All Foods in Database ---'));
    console.log(table.toString());

    await inquirer.prompt({ type: 'input', name: 'ack', message: '\nPress Enter to continue...' });
};
const addFood = async () => { 
    console.clear();
    console.log(chalk.bold.cyan('\n--- Add a New Food ---'));
    await createNewFood();
    await inquirer.prompt({ type: 'input', name: 'ack', message: '\nPress Enter to continue...' });
};
const editFood = async () => { 
    console.clear();
    console.log(chalk.bold.cyan('\n--- Edit a Food ---'));

    const fuse = new Fuse(foodCache, {
        keys: ['name'],
        includeScore: true,
        threshold: 0.4,
    });

    const { foodIdToEdit } = await inquirer.prompt({
        type: 'autocomplete',
        name: 'foodIdToEdit',
        message: 'Search for a food to edit:',
        source: async (answersSoFar, input) => {
            input = input || '';
            const searchResults = fuse.search(input).map(result => ({
                name: `${result.item.name} (${result.item.kcal} kcal)`,
                value: result.item._id,
            }));
            return [
                { name: '❌ Cancel', value: 'CANCEL' },
                new inquirer.Separator(),
                ...searchResults,
            ];
        },
    });

    if (foodIdToEdit === 'CANCEL') {
        console.log(chalk.yellow('\nEdit cancelled.'));
        await inquirer.prompt({ type: 'input', name: 'ack', message: 'Press Enter to continue...' });
        return;
    }

    const foodToEdit = foodCache.find(f => f._id.equals(foodIdToEdit));
    if (!foodToEdit) {
        console.log(chalk.red('\nCould not find the selected food. It might have been deleted.'));
        await inquirer.prompt({ type: 'input', name: 'ack', message: 'Press Enter to continue...' });
        return;
    }

    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'newName',
            message: 'Enter the new name:',
            default: foodToEdit.name,
        },
        {
            type: 'input',
            name: 'newKcalStr',
            message: 'Enter the new calories:',
            default: foodToEdit.kcal,
            validate: input => {
                const kcal = parseFloat(input);
                return !isNaN(kcal) && kcal >= 0 || 'Please enter a valid number for calories.';
            }
        }
    ]);

    const newName = answers.newName;
    const newKcal = parseFloat(answers.newKcalStr);

    try {
        await Food.updateOne({ _id: foodToEdit._id }, {
            $set: { name: newName, kcal: newKcal }
        });

        // Update cache
        foodToEdit.name = newName;
        foodToEdit.kcal = newKcal;

        console.log(chalk.green('\n✅ Food successfully updated!'));
    } catch (error) {
        if (error.code === 11000) { // Duplicate key error
            console.log(chalk.red(`\nError: A food named "${newName}" already exists.`));
        } else {
            console.log(chalk.red(`\nError updating food: ${error.message}`));
        }
    }
    
    await inquirer.prompt({ type: 'input', name: 'ack', message: 'Press Enter to continue...' });
};
const deleteFood = async () => { 
    console.clear();
    console.log(chalk.bold.cyan('\n--- Delete a Food ---'));

    const fuse = new Fuse(foodCache, {
        keys: ['name'],
        includeScore: true,
        threshold: 0.4,
    });

    const { foodIdToDelete } = await inquirer.prompt({
        type: 'autocomplete',
        name: 'foodIdToDelete',
        message: 'Search for a food to delete:',
        source: async (answersSoFar, input) => {
            input = input || '';
            const searchResults = fuse.search(input).map(result => ({
                name: `${result.item.name} (${result.item.kcal} kcal)`,
                value: result.item._id,
            }));
            return [
                { name: '❌ Cancel', value: 'CANCEL' },
                new inquirer.Separator(),
                ...searchResults,
            ];
        },
    });

    if (foodIdToDelete === 'CANCEL') {
        console.log(chalk.yellow('\nDeletion cancelled.'));
        await inquirer.prompt({ type: 'input', name: 'ack', message: 'Press Enter to continue...' });
        return;
    }

    const foodToDelete = foodCache.find(f => f._id.equals(foodIdToDelete));
    if (!foodToDelete) {
        console.log(chalk.red('\nCould not find the selected food. It might have been deleted already.'));
        await inquirer.prompt({ type: 'input', name: 'ack', message: 'Press Enter to continue...' });
        return;
    }

    const { confirmDelete } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirmDelete',
        message: `Are you sure you want to delete "${foodToDelete.name}"? This action cannot be undone.`,
        default: false,
    }]);

    if (confirmDelete) {
        try {
            await Food.deleteOne({ _id: foodToDelete._id });
            
            // Update cache
            foodCache = foodCache.filter(f => !f._id.equals(foodToDelete._id));

            console.log(chalk.green(`\n🗑️ "${foodToDelete.name}" has been deleted.`));
        } catch (error) {
            console.log(chalk.red(`\nError deleting food: ${error.message}`));
        }
    } else {
        console.log(chalk.yellow('\nDeletion cancelled.'));
    }

    await inquirer.prompt({ type: 'input', name: 'ack', message: 'Press Enter to continue...' });
};

main();
