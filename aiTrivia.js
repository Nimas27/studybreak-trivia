const { OpenAI } = require('openai');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generate trivia questions using OpenAI
 * @param {string} topic - The topic for trivia questions
 * @param {number} count - Number of questions to generate
 * @param {string} difficulty - Difficulty level (easy, medium, hard)
 * @returns {Array} - Array of question objects
 */
async function generateTriviaQuestions(topic, count = 5, difficulty = 'medium') {
  try {
    console.log(`Generating ${count} ${difficulty} trivia questions on topic: ${topic}`);
    
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that generates trivia questions."
        },
        {
          role: "user",
          content: `Generate ${count} ${difficulty}-level multiple-choice trivia questions about ${topic}. 
                   For easy questions, use common knowledge. For medium questions, include some specific details.
                   For hard questions, include obscure facts and challenging content.
                   Each question should have 4 options with only one correct answer.
                   Format your response as a JSON object with a 'questions' field containing an array of question objects.
                   Each question object should have these fields:
                   - id: a unique number for each question (1, 2, 3, etc.)
                   - text: the question text
                   - options: array of 4 possible answers as strings
                   - correctIndex: index of the correct answer (0-3)
                   - timeLimit: time limit in seconds (10)`
        }
      ],
      response_format: { type: "json_object" }
    });

    console.log("Received response from OpenAI");
    
    // Debug the raw response content
    const responseContent = response.choices[0].message.content;
    console.log("Response content:", responseContent.substring(0, 100) + "...");
    
    let data;
    try {
      data = JSON.parse(responseContent);
      console.log("Parsed JSON successfully");
      console.log("Data structure:", Object.keys(data));
    } catch (parseError) {
      console.error("Error parsing JSON:", parseError);
      throw new Error("Failed to parse response from OpenAI");
    }
    
    // Check if the response has the expected structure
    if (!data.questions) {
      console.error("Response doesn't contain 'questions' field:", data);
      
      // If we have a different structure, try to adapt
      if (data.trivia_questions) {
        console.log("Found 'trivia_questions' field instead of 'questions'");
        data.questions = data.trivia_questions;
      } else {
        // Create questions from any array we find in the response
        const possibleQuestionArray = Object.values(data).find(val => Array.isArray(val));
        if (possibleQuestionArray) {
          console.log("Found an array in response, using as questions");
          data.questions = possibleQuestionArray;
        } else {
          throw new Error("Response doesn't contain a questions array");
        }
      }
    }
    
    if (!Array.isArray(data.questions)) {
      console.error("'questions' is not an array:", data.questions);
      throw new Error("Response format is incorrect - questions is not an array");
    }
    
    console.log("Successfully found questions array with length:", data.questions.length);
    
    // Add UUID to each question and ensure timeLimit is 10 seconds
    const questionsWithUuid = data.questions.map(question => ({
      ...question,
      id: uuidv4(), // Replace the numeric id with a UUID
      timeLimit: 10 // Ensure timeLimit is 10 seconds
    }));
    
    return questionsWithUuid;
  } catch (error) {
    console.error("Error generating trivia questions:", error);
    // Return fallback questions in case of error
    return getFallbackTriviaQuestions(difficulty);
  }
}

/**
 * Fallback questions in case AI generation fails
 * @param {string} difficulty - Difficulty level (easy, medium, hard)
 * @returns {Array} - Array of fallback question objects
 */
function getFallbackTriviaQuestions(difficulty = 'medium') {
  // Easy questions
  const easyQuestions = [
    {
      id: uuidv4(),
      text: "What is the capital of France?",
      options: ["Berlin", "London", "Paris", "Madrid"],
      correctIndex: 2,
      timeLimit: 10
    },
    {
      id: uuidv4(),
      text: "Which planet is known as the Red Planet?",
      options: ["Earth", "Mars", "Jupiter", "Venus"],
      correctIndex: 1,
      timeLimit: 10
    },
    {
      id: uuidv4(),
      text: "What element has the chemical symbol 'O'?",
      options: ["Gold", "Oxygen", "Iron", "Carbon"],
      correctIndex: 1,
      timeLimit: 10
    },
    {
      id: uuidv4(),
      text: "What is the largest mammal on Earth?",
      options: ["African Elephant", "Blue Whale", "Giraffe", "Hippopotamus"],
      correctIndex: 1,
      timeLimit: 10
    },
    {
      id: uuidv4(),
      text: "Who wrote 'Romeo and Juliet'?",
      options: ["Charles Dickens", "William Shakespeare", "Jane Austen", "Mark Twain"],
      correctIndex: 1,
      timeLimit: 10
    }
  ];
  
  // Medium questions
  const mediumQuestions = [
    {
      id: uuidv4(),
      text: "In which year did World War II end?",
      options: ["1943", "1945", "1947", "1950"],
      correctIndex: 1,
      timeLimit: 10
    },
    {
      id: uuidv4(),
      text: "Which element has the atomic number 79?",
      options: ["Silver", "Gold", "Platinum", "Copper"],
      correctIndex: 1,
      timeLimit: 10
    },
    {
      id: uuidv4(),
      text: "What is the capital of Australia?",
      options: ["Sydney", "Melbourne", "Canberra", "Perth"],
      correctIndex: 2,
      timeLimit: 10
    },
    {
      id: uuidv4(),
      text: "Who painted 'Starry Night'?",
      options: ["Pablo Picasso", "Claude Monet", "Vincent van Gogh", "Leonardo da Vinci"],
      correctIndex: 2,
      timeLimit: 10
    },
    {
      id: uuidv4(),
      text: "Which country is home to the Great Barrier Reef?",
      options: ["Brazil", "Australia", "Thailand", "Mexico"],
      correctIndex: 1,
      timeLimit: 10
    }
  ];
  
  // Hard questions
  const hardQuestions = [
    {
      id: uuidv4(),
      text: "What is the smallest prime number greater than 100?",
      options: ["101", "103", "107", "109"],
      correctIndex: 0,
      timeLimit: 10
    },
    {
      id: uuidv4(),
      text: "Who was the first woman to win a Nobel Prize?",
      options: ["Marie Curie", "Rosalind Franklin", "Dorothy Hodgkin", "Barbara McClintock"],
      correctIndex: 0,
      timeLimit: 10
    },
    {
      id: uuidv4(),
      text: "What is the capital of Bhutan?",
      options: ["Thimphu", "Kathmandu", "Dhaka", "Ulaanbaatar"],
      correctIndex: 0,
      timeLimit: 10
    },
    {
      id: uuidv4(),
      text: "In which year was the first Olympic Games held in ancient Greece?",
      options: ["776 BC", "896 BC", "480 BC", "520 BC"],
      correctIndex: 0,
      timeLimit: 10
    },
    {
      id: uuidv4(),
      text: "Who composed the opera 'The Magic Flute'?",
      options: ["Johann Sebastian Bach", "Ludwig van Beethoven", "Wolfgang Amadeus Mozart", "Richard Wagner"],
      correctIndex: 2,
      timeLimit: 10
    }
  ];
  
  // Select based on difficulty
  if (difficulty === 'easy') return easyQuestions;
  if (difficulty === 'hard') return hardQuestions;
  return mediumQuestions; // Default to medium
}

module.exports = {
  generateTriviaQuestions
};