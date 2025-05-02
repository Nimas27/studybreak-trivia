const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { generateTriviaQuestions } = require('./aiTrivia');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: false
  }
});

// Active rooms data (in-memory)
const activeRooms = {};

// Socket.io connection handlers
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Create a new room
  socket.on('create-room', async (data, callback) => {
    const roomId = generateRoomId();
    
    const user = {
      id: socket.id,
      username: data.host.username,
      isHost: true,
      score: 0
    };
    
    const room = {
      id: roomId,
      name: data.roomName,
      host: socket.id,
      participants: [user],
      settings: data.settings,
      currentMode: 'study',
      timerRunning: false,
      timerValue: data.settings.studyTime,
      triviaCategory: data.triviaCategory || 'General Knowledge', 
      triviaQuestions: [],
      currentQuestionIndex: -1,
      timerInterval: null
    };
    
    activeRooms[roomId] = room;
    socket.join(roomId);
    
    // We'll load questions when trivia mode starts instead of immediately
    callback(roomId);
  });
  
  // Join an existing room
  socket.on('join-room', (data, callback) => {
    console.log("Join room request received:", data);
    
    const { roomId, user } = data;
    const room = activeRooms[roomId];
    
    if (!room) {
      console.log("Room not found:", roomId);
      callback(false);
      return;
    }
    
    const newUser = {
      id: socket.id,
      username: user.username,
      isHost: false,
      score: 0
    };
    
    console.log("Adding user to room:", newUser);
    room.participants.push(newUser);
    socket.join(roomId);
    
    io.to(roomId).emit('room-updated', room);
    callback(true);
  });
  
  // Get room data
  socket.on('get-room', (roomId, callback) => {
    const room = activeRooms[roomId];
    callback(room);
  });
  
  // Leave room
  socket.on('leave-room', (roomId) => {
    const room = activeRooms[roomId];
    if (room) {
      // Remove user from participants
      room.participants = room.participants.filter(p => p.id !== socket.id);
      
      // If host leaves, assign a new host or close the room
      if (socket.id === room.host) {
        if (room.participants.length > 0) {
          const newHost = room.participants[0];
          newHost.isHost = true;
          room.host = newHost.id;
        } else {
          // Close the room if no participants remain
          clearInterval(room.timerInterval);
          delete activeRooms[roomId];
          return;
        }
      }
      
      socket.leave(roomId);
      io.to(roomId).emit('room-updated', room);
    }
  });
  
  // Timer controls
  socket.on('start-timer', (roomId) => {
    const room = activeRooms[roomId];
    if (room && socket.id === room.host && !room.timerRunning) {
      room.timerRunning = true;
      
      // Clear any existing interval
      if (room.timerInterval) {
        clearInterval(room.timerInterval);
      }
      
      // Start the timer
      room.timerInterval = setInterval(() => {
        room.timerValue -= 1;
        
        // Send timer update to all clients
        io.to(roomId).emit('timer-update', {
          timeLeft: room.timerValue,
          isRunning: room.timerRunning
        });
        
        // Check if timer reached zero
        if (room.timerValue <= 0) {
          clearInterval(room.timerInterval);
          room.timerRunning = false;
          
          // Switch modes
          if (room.currentMode === 'study') {
            room.currentMode = 'trivia';
            room.timerValue = room.settings.breakTime;
            startTriviaSession(roomId);
          } else {
            room.currentMode = 'study';
            room.timerValue = room.settings.studyTime;
            endTriviaSession(roomId);
          }
          
          io.to(roomId).emit('mode-changed', room.currentMode);
          io.to(roomId).emit('timer-update', {
            timeLeft: room.timerValue,
            isRunning: room.timerRunning
          });
        }
      }, 1000);
    }
  });
  
  socket.on('pause-timer', (roomId) => {
    const room = activeRooms[roomId];
    if (room && socket.id === room.host && room.timerRunning) {
      clearInterval(room.timerInterval);
      room.timerRunning = false;
      
      io.to(roomId).emit('timer-update', {
        timeLeft: room.timerValue,
        isRunning: false
      });
    }
  });
  
  socket.on('skip-timer', (roomId) => {
    const room = activeRooms[roomId];
    if (room && socket.id === room.host) {
      // Clear any existing interval
      if (room.timerInterval) {
        clearInterval(room.timerInterval);
      }
      
      room.timerRunning = false;
      
      // Switch modes
      if (room.currentMode === 'study') {
        room.currentMode = 'trivia';
        room.timerValue = room.settings.breakTime;
        startTriviaSession(roomId);
      } else {
        room.currentMode = 'study';
        room.timerValue = room.settings.studyTime;
        endTriviaSession(roomId);
      }
      
      io.to(roomId).emit('mode-changed', room.currentMode);
      io.to(roomId).emit('timer-update', {
        timeLeft: room.timerValue,
        isRunning: false
      });
    }
  });
  
  // Answer submission
  socket.on('submit-answer', (data) => {
    const { roomId, questionId, answerIndex, timeRemaining } = data;
    const room = activeRooms[roomId];
    
    if (room && room.currentMode === 'trivia') {
      const currentQuestion = room.triviaQuestions[room.currentQuestionIndex];
      
      if (currentQuestion && questionId === currentQuestion.id) {
        // Check if answer is correct
        const isCorrect = answerIndex === currentQuestion.correctIndex;
        
        if (isCorrect) {
          // Calculate score based on time remaining
          // The faster the answer, the higher the score
          const pointsEarned = Math.ceil(timeRemaining * (20 / currentQuestion.timeLimit));
          
          // Update participant's score
          const participant = room.participants.find(p => p.id === socket.id);
          if (participant) {
            participant.score += pointsEarned;
            
            // Send updated scores to all clients
            io.to(roomId).emit('score-update', room.participants.map(p => ({
              userId: p.id,
              username: p.username,
              score: p.score
            })));
          }
        }
      }
    }
  });
  
  // Handle disconnections
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Find rooms the user was in
    Object.keys(activeRooms).forEach(roomId => {
      const room = activeRooms[roomId];
      if (!room) return;
      
      const participantIndex = room.participants.findIndex(p => p.id === socket.id);
      
      if (participantIndex !== -1) {
        // User was in this room
        console.log(`Removing user ${socket.id} from room ${roomId}`);
        
        // Check if user is host
        const isHost = socket.id === room.host;
        
        // Remove user
        room.participants.splice(participantIndex, 1);
        
        // If host leaves, assign a new host or close the room
        if (isHost) {
          if (room.participants.length > 0) {
            const newHost = room.participants[0];
            newHost.isHost = true;
            room.host = newHost.id;
            console.log(`New host assigned: ${newHost.username}`);
          } else {
            // Close the room if no participants remain
            console.log(`Closing empty room: ${roomId}`);
            if (room.timerInterval) {
              clearInterval(room.timerInterval);
            }
            delete activeRooms[roomId];
            return;
          }
        }
        
        // Notify remaining participants
        io.to(roomId).emit('room-updated', room);
      }
    });
  });
});

// Helper function to generate room ID
function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Start a trivia session
async function startTriviaSession(roomId) {
  const room = activeRooms[roomId];
  if (!room) return;
  
  room.currentQuestionIndex = -1;
  
  // Reset all participants' scores for this session
  room.participants.forEach(p => {
    p.score = 0;
  });
  
  // Send score reset to clients
  io.to(roomId).emit('score-update', room.participants.map(p => ({
    userId: p.id,
    username: p.username,
    score: p.score
  })));
  
  // Notify clients that we're loading questions
  io.to(roomId).emit('trivia-loading', true);
  
  // Generate or load trivia questions based on the category
  try {
    console.log(`Generating trivia for category: ${room.triviaCategory}`);
    // Use AI to generate questions
    room.triviaQuestions = await generateTriviaQuestions(room.triviaCategory, 5);
    
    // Notify clients that questions are ready
    io.to(roomId).emit('trivia-loading', false);
    
    // Start the first question after a short delay
    setTimeout(() => {
      nextTriviaQuestion(roomId);
    }, 2000);
  } catch (error) {
    console.error("Error generating trivia questions:", error);
    
    // Fallback to predefined questions if AI generation fails
    room.triviaQuestions = getPredefinedTriviaQuestions('general');
    
    io.to(roomId).emit('trivia-loading', false);
    
    // Start with predefined questions
    setTimeout(() => {
      nextTriviaQuestion(roomId);
    }, 2000);
  }
}

// Get questions from predefined sets
function getPredefinedTriviaQuestions(category, count = 5) {
  const generalKnowledge = [
    {
      id: uuidv4(),
      text: "What is the capital of France?",
      options: ["London", "Berlin", "Paris", "Madrid"],
      correctIndex: 2,
      timeLimit: 15
    },
    {
      id: uuidv4(),
      text: "Which planet is closest to the Sun?",
      options: ["Venus", "Mercury", "Mars", "Earth"],
      correctIndex: 1,
      timeLimit: 15
    },
    {
      id: uuidv4(),
      text: "What is the chemical symbol for gold?",
      options: ["Go", "Gd", "Au", "Ag"],
      correctIndex: 2,
      timeLimit: 15
    },
    {
      id: uuidv4(),
      text: "How many sides does a hexagon have?",
      options: ["5", "6", "7", "8"],
      correctIndex: 1,
      timeLimit: 15
    },
    {
      id: uuidv4(),
      text: "What is the largest ocean on Earth?",
      options: ["Atlantic", "Indian", "Arctic", "Pacific"],
      correctIndex: 3,
      timeLimit: 15
    }
  ];
  
  const popCulture = [
    {
      id: uuidv4(),
      text: "Which actor played Iron Man in the Marvel Cinematic Universe?",
      options: ["Chris Hemsworth", "Robert Downey Jr.", "Chris Evans", "Mark Ruffalo"],
      correctIndex: 1,
      timeLimit: 15
    },
    {
      id: uuidv4(),
      text: "What is the name of the fictional continent in Game of Thrones?",
      options: ["Essos", "Westeros", "Northeros", "Southeros"],
      correctIndex: 1,
      timeLimit: 15
    },
    {
      id: uuidv4(),
      text: "Which band performed the song 'Bohemian Rhapsody'?",
      options: ["The Beatles", "Queen", "Led Zeppelin", "AC/DC"],
      correctIndex: 1,
      timeLimit: 15
    },
    {
      id: uuidv4(),
      text: "Which movie franchise features a character named Harry Potter?",
      options: ["The Lord of the Rings", "Star Wars", "Harry Potter", "The Chronicles of Narnia"],
      correctIndex: 2,
      timeLimit: 15
    },
    {
      id: uuidv4(),
      text: "Who painted the Mona Lisa?",
      options: ["Vincent van Gogh", "Pablo Picasso", "Leonardo da Vinci", "Michelangelo"],
      correctIndex: 2,
      timeLimit: 15
    }
  ];
  
  // Select appropriate question set
  let questions = category === 'general' ? generalKnowledge : popCulture;
  
  // Return requested number of questions
  return questions.slice(0, count);
}

// Display the next trivia question
function nextTriviaQuestion(roomId) {
  const room = activeRooms[roomId];
  if (!room || room.currentMode !== 'trivia') return;
  
  room.currentQuestionIndex++;
  
  // Check if we've reached the end of questions
  if (room.currentQuestionIndex >= room.triviaQuestions.length) {
    // End of trivia session
    return;
  }
  
  const currentQuestion = room.triviaQuestions[room.currentQuestionIndex];
  
  // Send the new question to all clients
  io.to(roomId).emit('new-question', {
    question: {
      id: currentQuestion.id,
      text: currentQuestion.text,
      options: currentQuestion.options,
      correctIndex: null // Don't send the correct answer yet
    },
    timeLimit: currentQuestion.timeLimit,
    index: room.currentQuestionIndex,
    total: room.triviaQuestions.length
  });
  
  let questionTimer = currentQuestion.timeLimit;
  
  // Start question timer
  const questionInterval = setInterval(() => {
    questionTimer--;
    
    // Send timer update
    io.to(roomId).emit('question-timer', questionTimer);
    
    if (questionTimer <= 0) {
      clearInterval(questionInterval);
      
      // Reveal the correct answer
      io.to(roomId).emit('question-ended', {
        correctIndex: currentQuestion.correctIndex
      });
      
      // Wait a few seconds before moving to next question
      setTimeout(() => {
        nextTriviaQuestion(roomId);
      }, 3000);
    }
  }, 1000);
}

// End a trivia session
function endTriviaSession(roomId) {
  const room = activeRooms[roomId];
  if (!room) return;
  
  // Announce the winner
  const sortedParticipants = [...room.participants].sort((a, b) => b.score - a.score);
  const winner = sortedParticipants[0];
  
  if (winner) {
    io.to(roomId).emit('trivia-session-ended', {
      winner: {
        id: winner.id,
        username: winner.username,
        score: winner.score
      },
      allScores: room.participants.map(p => ({
        id: p.id,
        username: p.username,
        score: p.score
      }))
    });
  }
}

// Basic route for checking server status
app.get('/', (req, res) => {
  res.send('StudyBreak Trivia Server is running');
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});