const SUPABASE_URL = "https://dlnsgydsevubdbsfpipg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_PHJsJon2xr4yeXPWxBBaIg_76jD8Op-";

const dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener("DOMContentLoaded", () => {
  const recipeGrid = document.getElementById("recipe-grid");
  const categoryButtons = document.querySelectorAll(".category-tag");
  const searchInput = document.getElementById("recipe-search-input");

  let currentCategory = ""; // Store the currently active category

  // Function to fetch recipes from the backend
  async function fetchRecipes(category = "", searchTerm = "") {
    let url = `/api/backend-recipes?`;
    if (category) {
      url += `category=${encodeURIComponent(category)}&`;
    }
    if (searchTerm) {
      url += `search=${encodeURIComponent(searchTerm)}&`;
    }
    // Remove trailing & if any
    url = url.endsWith("&") ? url.slice(0, -1) : url;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const recipes = await response.json();
      renderRecipeCards(recipes);
    } catch (error) {
      console.error("Error fetching recipes:", error);
      recipeGrid.innerHTML = `<p class="error-message">Failed to load recipes. Please try again later.</p>`;
    }
  }

  // Function to render recipe cards
  function renderRecipeCards(recipes) {
    recipeGrid.innerHTML = ""; // Clear existing cards
    if (recipes.length === 0) {
      recipeGrid.innerHTML = `<p class="empty-state-message">No recipes found for this category or search term.</p>`;
      return;
    }

    recipes.forEach((recipe) => {
      const card = document.createElement("div");
      card.className = "recipe-card"; // Apply floating card styling

      const imageUrl = recipe.image_url || "https://via.placeholder.com/400x300?text=Recipe+Image"; // Placeholder if no image

      card.innerHTML = `
        <div class="image-container">
          <img src="${imageUrl}" alt="${recipe.name}" loading="lazy">
        </div>
        <div class="card-content">
          <h3 class="text-block">${recipe.name}</h3>
          <p class="text-block recipe-description">${recipe.description}</p>
          <div class="recipe-meta">
            ${recipe.prep_time_minutes ? `<span>Prep: ${recipe.prep_time_minutes}m</span>` : ''}
            ${recipe.cook_time_minutes ? `<span>Cook: ${recipe.cook_time_minutes}m</span>` : ''}
            ${recipe.servings ? `<span>Servings: ${recipe.servings}</span>` : ''}
          </div>
          <button class="button primary-button">View Recipe</button>
        </div>
      `;
      recipeGrid.appendChild(card);
    });
  }

  // Event listeners for category buttons
  categoryButtons.forEach((button) => {
    button.addEventListener("click", () => {
      categoryButtons.forEach(btn => btn.classList.remove("active"));
      button.classList.add("active");
      currentCategory = button.dataset.category === "All" ? "" : button.dataset.category;
      fetchRecipes(currentCategory, searchInput.value);
    });
  });

  // Event listener for search input
  let searchTimeout;
  searchInput.addEventListener("input", (event) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      fetchRecipes(currentCategory, event.target.value);
    }, 300); // Debounce search input
  });

  // Initial load
  // Set 'All' category button as active on initial load
  const allCategoryButton = document.querySelector('.category-tag[data-category="All"]');
  if (allCategoryButton) {
    allCategoryButton.classList.add('active');
  }
  fetchRecipes();
});
