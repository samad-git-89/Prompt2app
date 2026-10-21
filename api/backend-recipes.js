// This is a Vercel serverless function (or similar NodeJS backend)
// It simulates fetching recipes from a database, fulfilling the 'server-side business logic' requirement
// In a real application, you would connect to Supabase securely using environment variables for keys.

export default async function handler(req, res) {
  if (req.method === "GET") {
    const mockRecipes = [
      {
        id: "1",
        created_at: new Date().toISOString(),
        name: "Classic Pancakes",
        description: "Fluffy pancakes, perfect for a weekend breakfast. Serve with your favorite syrup and fresh berries.",
        image_url: "https://images.unsplash.com/photo-1549611084-ad61b6c7a6e1?q=80&w=2940&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
        category: "Breakfast",
        prep_time_minutes: 10,
        cook_time_minutes: 15,
        servings: 4,
      },
      {
        id: "2",
        created_at: new Date().toISOString(),
        name: "Spaghetti Bolognese",
        description: "A rich and hearty Italian meat sauce served over al dente spaghetti. A family favorite.",
        image_url: "https://images.unsplash.com/photo-1598858204642-e06530a6c0b3?q=80&w=2940&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
        category: "Dinner",
        prep_time_minutes: 20,
        cook_time_minutes: 45,
        servings: 6,
      },
      {
        id: "3",
        created_at: new Date().toISOString(),
        name: "Chocolate Lava Cake",
        description: "Decadent individual chocolate cakes with a molten, gooey center. Best served warm with a scoop of ice cream.",
        image_url: "https://images.unsplash.com/photo-1560965158-94116246f481?q=80&w=2940&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
        category: "Dessert",
        prep_time_minutes: 15,
        cook_time_minutes: 12,
        servings: 2,
      },
      {
        id: "4",
        created_at: new Date().toISOString(),
        name: "Caesar Salad with Grilled Chicken",
        description: "A fresh and crunchy romaine salad with tender grilled chicken breast, Parmesan, and creamy Caesar dressing.",
        image_url: "https://images.unsplash.com/photo-1512621776951-a5796a2fceb7?q=80&w=2940&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
        category: "Lunch",
        prep_time_minutes: 15,
        cook_time_minutes: 20,
        servings: 2,
      },
      {
        id: "5",
        created_at: new Date().toISOString(),
        name: "Blueberry Muffins",
        description: "Moist and flavorful muffins bursting with fresh blueberries and a hint of lemon zest.",
        image_url: "https://images.unsplash.com/photo-1592383827552-a39c9f2b8f8d?q=80&w=2940&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
        category: "Breakfast",
        prep_time_minutes: 10,
        cook_time_minutes: 25,
        servings: 12,
      },
      {
        id: "6",
        created_at: new Date().toISOString(),
        name: "Vegetable Stir-Fry",
        description: "Quick and healthy stir-fried vegetables with a savory ginger-garlic sauce, perfect for a weeknight meal.",
        image_url: "https://images.unsplash.com/photo-1512058564036-f67e719139d4?q=80&w=2940&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
        category: "Dinner",
        prep_time_minutes: 15,
        cook_time_minutes: 10,
        servings: 3,
      },
      {
        id: "7",
        created_at: new Date().toISOString(),
        name: "Lemon Meringue Pie",
        description: "A classic dessert with a bright, tart lemon filling and a sweet, airy meringue topping.",
        image_url: "https://images.unsplash.com/photo-1589182370966-fd751ef9482d?q=80&w=2940&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
        category: "Dessert",
        prep_time_minutes: 30,
        cook_time_minutes: 30,
        servings: 8,
      },
      {
        id: "8",
        created_at: new Date().toISOString(),
        name: "Chicken Caesar Wrap",
        description: "All the flavors of a Caesar salad, conveniently wrapped in a soft tortilla.",
        image_url: "https://images.unsplash.com/photo-1621644781440-272e25d2b0e2?q=80&w=2940&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
        category: "Lunch",
        prep_time_minutes: 10,
        cook_time_minutes: 10,
        servings: 1,
      }
    ];

    let filteredRecipes = [...mockRecipes];
    const { category, search } = req.query;

    if (category) {
      filteredRecipes = filteredRecipes.filter(
        (recipe) => recipe.category.toLowerCase() === category.toLowerCase()
      );
    }

    if (search) {
      const searchTermLower = search.toLowerCase();
      filteredRecipes = filteredRecipes.filter(
        (recipe) =>
          recipe.name.toLowerCase().includes(searchTermLower) ||
          recipe.description.toLowerCase().includes(searchTermLower) ||
          (recipe.category && recipe.category.toLowerCase().includes(searchTermLower))
      );
    }

    res.status(200).json(filteredRecipes);
  } else {
    res.setHeader("Allow", ["GET"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
