/**
 * Estimates macronutrients based on total calories and food category
 * @param {number} totalKcal - Total calories for the food
 * @param {string} category - Food category ('protein-heavy', 'carb-heavy', 'fat-heavy', 'mixed')
 * @returns {Object} Object containing estimated protein, carbs, and fat values
 */
const estimateMacros = (totalKcal, category = 'mixed') => {
  const ratios = {
    'protein-heavy': { protein: 0.4, carbs: 0.2, fat: 0.3 }, // Higher protein foods
    'carb-heavy': { protein: 0.15, carbs: 0.7, fat: 0.15 }, // Carb-rich foods
    'fat-heavy': { protein: 0.1, carbs: 0.1, fat: 0.8 },    // Fat-rich foods
    'mixed': { protein: 0.3, carbs: 0.4, fat: 0.3 }        // Balanced foods
  };
  
  const r = ratios[category];
  
  // Convert calories to grams (4 cal/g for protein/carbs, 9 cal/g for fat)
  const protein = Math.round((totalKcal * r.protein) / 4);
  const carbs = Math.round((totalKcal * r.carbs) / 4);
  const fat = Math.round((totalKcal * r.fat) / 9);
  
  return { protein, carbs, fat };
};

/**
 * Calculates total calories from macros
 * @param {number} protein - Grams of protein
 * @param {number} carbs - Grams of carbs
 * @param {number} fat - Grams of fat
 * @returns {number} Total calories
 */
const calculateCaloriesFromMacros = (protein, carbs, fat) => {
  return Math.round((protein * 4) + (carbs * 4) + (fat * 9));
};

export { estimateMacros, calculateCaloriesFromMacros };