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

// Helper function to generate room ID
function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Socket.io connection handlers
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Create a new room
  socket.on('create-room', async (data, callback) => {
    console.log('Create room request received:', data);
    
    try {
      const roomId = generateRoomId();
      console.log('Generated room ID:', roomId);
      
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
        timerInterval: null,
        breakEndTime: null,
        inactivityCount: 0,
        questionActivityTimestamp: null,
        questionHasActivity: false,
        breakTimerInterval: null,
        triviaPaused: false,
        pendingAnswers: [],
        playTrivia: data.playTrivia !== undefined ? data.playTrivia : true,
        triviaDifficulty: data.triviaDifficulty || 'medium',
        lastTriviaCategory: data.triviaCategory || 'General Knowledge'
      };
      
      activeRooms[roomId] = room;
      socket.join(roomId);
      
      console.log('User joined room:', {roomId, userId: socket.id});
      
      if (typeof callback === 'function') {
        callback(roomId);
      } else {
        console.error('Callback is not a function:', callback);
      }
    } catch (error) {
      console.error('Error creating room:', error);
      if (typeof callback === 'function') {
        callback(null); // Return null to indicate failure
      }
    }
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
          if (room.breakTimerInterval) {
            clearInterval(room.breakTimerInterval);
          }
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
    console.log(`Start timer request received for room ${roomId}`);
    const room = activeRooms[roomId];
    
    if (!room) {
      console.log(`Room ${roomId} not found`);
      return;
    }
    
    if (socket.id !== room.host) {
      console.log(`User ${socket.id} is not host, cannot start timer`);
      return;
    }
    
    console.log(`Starting timer in room ${roomId}, mode: ${room.currentMode}`);
    
    // Make sure we have a positive time value
    if (room.timerValue <= 0) {
      // Reset to the appropriate timer based on mode
      if (room.currentMode === 'study') {
        room.timerValue = room.settings.studyTime;
      } else {
        room.timerValue = room.settings.breakTime;
      }
    }
    
    // Clear any existing interval first
    if (room.timerInterval) {
      clearInterval(room.timerInterval);
      room.timerInterval = null;
    }
    
    if (room.breakTimerInterval) {
      clearInterval(room.breakTimerInterval);
      room.breakTimerInterval = null;
    }
    
    room.timerRunning = true;
    
    // Start the appropriate timer based on mode
    if (room.currentMode === 'study') {
      // Study timer
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
          
          // Switch to trivia mode
          room.currentMode = 'trivia';
          room.timerValue = room.settings.breakTime;
          
          io.to(roomId).emit('mode-changed', room.currentMode);
          io.to(roomId).emit('timer-update', {
            timeLeft: room.timerValue,
            isRunning: false
          });
          
          // Start trivia session
          startTriviaSession(roomId);
        }
      }, 1000);
    } else if (room.currentMode === 'trivia') {
      // Break timer - calculate remaining time
      const currentTime = Date.now();
      const remainingTimeSeconds = Math.max(0, Math.floor((room.breakEndTime - currentTime) / 1000));
      
      if (remainingTimeSeconds > 0) {
        // Update with the correct remaining time
        room.timerValue = remainingTimeSeconds;
        
        // Reset break end time to the future
        room.breakEndTime = currentTime + (remainingTimeSeconds * 1000);
        
        // Start break timer updates
        room.breakTimerInterval = setInterval(() => {
          sendBreakTimeUpdate(roomId);
        }, 1000);
      } else {
        // Break time is already over, switch to study mode
        endTriviaSession(roomId);
        
        room.currentMode = 'study';
        room.timerValue = room.settings.studyTime;
        
        io.to(roomId).emit('mode-changed', room.currentMode);
        io.to(roomId).emit('timer-update', {
          timeLeft: room.timerValue,
          isRunning: false
        });
        
        return;
      }
    }
    
    // Confirm timer started
    io.to(roomId).emit('timer-update', {
      timeLeft: room.timerValue,
      isRunning: room.timerRunning
    });
  });
  
  socket.on('pause-timer', (roomId) => {
    console.log(`Pause timer request received for room ${roomId}`);
    const room = activeRooms[roomId];
    
    if (!room) {
      console.log(`Room ${roomId} not found`);
      return;
    }
    
    if (socket.id !== room.host) {
      console.log(`User ${socket.id} is not host, cannot pause timer`);
      return;
    }
    
    console.log(`Pausing timer in room ${roomId}, mode: ${room.currentMode}`);
    
    // Clear the appropriate timer based on mode
    if (room.currentMode === 'study') {
      if (room.timerInterval) {
        clearInterval(room.timerInterval);
        room.timerInterval = null;
      }
    } else if (room.currentMode === 'trivia') {
      if (room.breakTimerInterval) {
        clearInterval(room.breakTimerInterval);
        room.breakTimerInterval = null;
      }
    }
    
    room.timerRunning = false;
    
    // Notify all clients
    io.to(roomId).emit('timer-update', {
      timeLeft: room.timerValue,
      isRunning: false
    });
  });
  
  socket.on('skip-timer', (roomId) => {
    console.log(`Skip timer request received for room ${roomId}`);
    const room = activeRooms[roomId];
    if (!room || socket.id !== room.host) {
      return;
    }
    
    // Clear any existing interval
    if (room.timerInterval) {
      clearInterval(room.timerInterval);
      room.timerInterval = null;
    }
    
    if (room.breakTimerInterval) {
      clearInterval(room.breakTimerInterval);
      room.breakTimerInterval = null;
    }
    
    room.timerRunning = false;
    
    const previousMode = room.currentMode;
    
    // Switch modes
    if (room.currentMode === 'study') {
      console.log(`Skipping to trivia mode in room ${roomId}`);
      room.currentMode = 'trivia';
      room.timerValue = room.settings.breakTime;
      
      // Emit mode change BEFORE starting trivia
      io.to(roomId).emit('mode-changed', room.currentMode);
      io.to(roomId).emit('timer-update', {
        timeLeft: room.timerValue,
        isRunning: false
      });
      
      // Now start trivia
      startTriviaSession(roomId);
    } else {
      console.log(`Skipping to study mode in room ${roomId}`);
      room.currentMode = 'study';
      room.timerValue = room.settings.studyTime;
      
      // End trivia BEFORE emitting mode change
      endTriviaSession(roomId);
      
      io.to(roomId).emit('mode-changed', room.currentMode);
      io.to(roomId).emit('timer-update', {
        timeLeft: room.timerValue,
        isRunning: false
      });
    }
    
    console.log(`Mode successfully changed from ${previousMode} to ${room.currentMode}`);
  });
  
  // Topic selection
  // In server.js - Improve the select-topic handler
socket.on('select-topic', async (data) => {
  const { roomId, topic, difficulty } = data;
  const room = activeRooms[roomId];
  
  console.log(`Received select-topic: roomId=${roomId}, topic=${topic}, difficulty=${difficulty}`);
  
  if (!room) {
    console.log(`Room ${roomId} not found for topic selection`);
    return;
  }
  
  if (room.currentMode !== 'trivia') {
    console.log(`Room ${roomId} is not in trivia mode, ignoring topic selection`);
    return;
  }
  
  console.log(`User selected new topic: ${topic}, difficulty: ${difficulty}`);
  
  room.triviaCategory = topic;
  room.lastTriviaCategory = topic;
  room.triviaDifficulty = difficulty || 'medium';
  
  // Reset question index
  room.currentQuestionIndex = -1;
  
  // Notify clients that we're loading questions
  io.to(roomId).emit('trivia-loading', true);
  
  try {
    console.log(`Generating trivia for category: ${room.triviaCategory}, difficulty: ${room.triviaDifficulty}`);
    // Use AI to generate questions
    room.triviaQuestions = await generateTriviaQuestions(room.triviaCategory, 5, room.triviaDifficulty);
    console.log(`Generated ${room.triviaQuestions.length} questions successfully`);
    
    // Notify clients that questions are ready
    io.to(roomId).emit('trivia-loading', false);
    
    // Start the first question after a short delay
    setTimeout(() => {
      nextTriviaQuestion(roomId);
    }, 2000);
  } catch (error) {
    console.error("Error generating trivia questions:", error);
    
    // Fallback to predefined questions if AI generation fails
    console.log("Using fallback predefined questions");
    room.triviaQuestions = getPredefinedTriviaQuestions('general');
    
    io.to(roomId).emit('trivia-loading', false);
    
    // Start with predefined questions
    setTimeout(() => {
      nextTriviaQuestion(roomId);
    }, 2000);
  }
});
  
  // Answer submission
  socket.on('submit-answer', (data) => {
    const { roomId, questionId, answerIndex, timeRemaining } = data;
    const room = activeRooms[roomId];
    
    console.log(`Received answer from ${socket.id}: room=${roomId}, question=${questionId}, answer=${answerIndex}`);
    
    if (!room) {
      console.log(`Room ${roomId} not found for answer submission`);
      return;
    }
    
    if (room.currentMode !== 'trivia') {
      console.log(`Room ${roomId} not in trivia mode for answer submission`);
      return;
    }
    
    // If trivia was paused due to inactivity, resume it
    if (room.triviaPaused) {
      console.log(`Resuming trivia in room ${roomId} after inactivity`);
      room.triviaPaused = false;
      room.inactivityCount = 0;
      
      io.to(roomId).emit('trivia-message', {
        type: 'success',
        message: 'Trivia resumed!'
      });
      
      // Start a new question after a short delay
      setTimeout(() => {
        nextTriviaQuestion(roomId);
      }, 1500);
      
      return;
    }
    
    // Check if we have a current question
    if (!room.triviaQuestions || room.currentQuestionIndex < 0 || room.currentQuestionIndex >= room.triviaQuestions.length) {
      console.log(`No valid current question in room ${roomId}`);
      return;
    }
    
    const currentQuestion = room.triviaQuestions[room.currentQuestionIndex];
    
    if (currentQuestion && questionId === currentQuestion.id) {
      // Mark that we received an answer for this question
      room.questionHasActivity = true;
      room.inactivityCount = 0;
      
      // Store the answer to process at the end of the question
      room.pendingAnswers.push({
        userId: socket.id,
        answerIndex,
        timeRemaining,
        questionId
      });
      
      console.log(`Answer recorded for user ${socket.id}, pending answers: ${room.pendingAnswers.length}`);
      
      // Acknowledge receipt of answer to the user who submitted
      socket.emit('answer-received', {
        questionId,
        answerIndex
      });
    } else {
      console.log(`Question ID mismatch: expected=${currentQuestion?.id}, got=${questionId}`);
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
            if (room.breakTimerInterval) {
              clearInterval(room.breakTimerInterval);
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

// Start a trivia session
// In server.js - Add better logging in startTriviaSession
async function startTriviaSession(roomId) {
  const room = activeRooms[roomId];
  if (!room) return;
  
  console.log(`Starting trivia session for room ${roomId}. Trivia enabled: ${room.playTrivia}`);
  
  // Set the end time for the break
  room.breakEndTime = Date.now() + (room.settings.breakTime * 1000);
  
  // Start break timer updates regardless of trivia mode
  room.breakTimerInterval = setInterval(() => {
    sendBreakTimeUpdate(roomId);
  }, 1000);
  
  // If trivia is disabled, just notify clients about break mode
  if (!room.playTrivia) {
    console.log(`Trivia disabled for room ${roomId}, just taking a break`);
    io.to(roomId).emit('trivia-disabled', {
      message: "Taking a break. Trivia is disabled for this session.",
      breakTime: room.settings.breakTime
    });
    
    // When break time is over, we'll switch back to study mode automatically
    return;
  }
  
  // Reset trivia session state
  room.currentQuestionIndex = -1;
  room.inactivityCount = 0;
  room.triviaPaused = false;
  room.pendingAnswers = [];
  
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
  
  // Check if this is the first trivia session (no previous topic selection)
  if (!room.lastTriviaCategory) {
    console.log(`First trivia session for room ${roomId}, using default category: ${room.triviaCategory}`);
    
    // Notify clients we're loading questions
    io.to(roomId).emit('trivia-loading', true);
    
    try {
      // Generate questions directly without asking for topic selection
      room.triviaQuestions = await generateTriviaQuestions(room.triviaCategory, 5, room.triviaDifficulty);
      
      // Notify clients that questions are ready
      io.to(roomId).emit('trivia-loading', false);
      
      // Start the first question right away
      setTimeout(() => {
        nextTriviaQuestion(roomId);
      }, 2000);
    } catch (error) {
      console.error("Error generating initial trivia questions:", error);
      
      // Use fallback questions
      room.triviaQuestions = getPredefinedTriviaQuestions('general');
      
      io.to(roomId).emit('trivia-loading', false);
      
      // Start with fallback questions
      setTimeout(() => {
        nextTriviaQuestion(roomId);
      }, 2000);
    }
  } else {
    // Not the first session, show topic selection
    console.log(`Sending category selection prompt. Last category: ${room.lastTriviaCategory}`);
    
    // Send prompt to select/confirm trivia category
    io.to(roomId).emit('select-category', {
      lastCategory: room.lastTriviaCategory,
      difficulty: room.triviaDifficulty
    });
  }
}

// Display the next trivia question
// In server.js - Update nextTriviaQuestion function with detailed logging
function nextTriviaQuestion(roomId) {
  const room = activeRooms[roomId];
  if (!room || room.currentMode !== 'trivia') return;
  
  console.log(`[nextTriviaQuestion] Room ${roomId} - Starting next question logic`);
  
  // Check if the break time is over
  if (room.breakEndTime && Date.now() >= room.breakEndTime) {
    console.log(`[nextTriviaQuestion] Room ${roomId} - Break time is over, ending trivia session`);
    
    io.to(roomId).emit('trivia-message', {
      type: 'info',
      message: 'Break time is over, returning to study mode'
    });
    
    endTriviaSession(roomId);
    
    // Switch back to study mode
    room.currentMode = 'study';
    room.timerValue = room.settings.studyTime;
    
    io.to(roomId).emit('mode-changed', room.currentMode);
    io.to(roomId).emit('timer-update', {
      timeLeft: room.timerValue,
      isRunning: false
    });
    
    return;
  }
  
  // Check for consecutive inactivity
  if (room.inactivityCount >= 2) {
    console.log(`[nextTriviaQuestion] Room ${roomId} - Detected inactivity (count: ${room.inactivityCount}), pausing trivia questions`);
    
    io.to(roomId).emit('trivia-message', {
      type: 'warning',
      message: 'Trivia paused due to inactivity. Click any answer to resume trivia.'
    });
    
    // Set a flag that trivia is paused due to inactivity
    room.triviaPaused = true;
    return;
  }
  
  // If trivia is paused, don't show more questions
  if (room.triviaPaused) {
    console.log(`[nextTriviaQuestion] Room ${roomId} - Trivia is paused, not showing next question`);
    return;
  }
  
  room.currentQuestionIndex++;
  
  // Check if we've reached the end of questions
  if (room.currentQuestionIndex >= room.triviaQuestions.length) {
    console.log(`[nextTriviaQuestion] Room ${roomId} - Reached end of questions, starting new set`);
    
    // Reset index and start from beginning
    room.currentQuestionIndex = 0;
  }
  
  // Validate triviaQuestions array
  if (!room.triviaQuestions || !Array.isArray(room.triviaQuestions) || room.triviaQuestions.length === 0) {
    console.error(`[nextTriviaQuestion] Room ${roomId} - No trivia questions available!`);
    io.to(roomId).emit('trivia-message', {
      type: 'error',
      message: 'Error: No trivia questions available. Please try a different category.'
    });
    
    // Regenerate with fallback questions
    room.triviaQuestions = getPredefinedTriviaQuestions('general');
    room.currentQuestionIndex = 0;
  }
  
  const currentQuestion = room.triviaQuestions[room.currentQuestionIndex];
  
  if (!currentQuestion) {
    console.error(`[nextTriviaQuestion] Room ${roomId} - Failed to get question at index ${room.currentQuestionIndex}`);
    return;
  }
  
  console.log(`[nextTriviaQuestion] Room ${roomId} - Sending question: "${currentQuestion.text.substring(0, 30)}..."`);
  
  // Reset question activity flag
  room.questionActivityTimestamp = Date.now();
  room.questionHasActivity = false; // Track if anyone answered this question
  room.pendingAnswers = []; // Clear pending answers for the new question
  
  // Send the new question to all clients
  io.to(roomId).emit('new-question', {
    question: {
      id: currentQuestion.id,
      text: currentQuestion.text,
      options: currentQuestion.options,
      correctIndex: null // Don't send the correct answer yet
    },
    timeLimit: currentQuestion.timeLimit,
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
      
      // Make sure room and question still exist
      if (!activeRooms[roomId] || !activeRooms[roomId].triviaQuestions || !activeRooms[roomId].triviaQuestions[activeRooms[roomId].currentQuestionIndex]) {
        console.error(`Room or question no longer exists`);
        return;
      }
      
      const currentQuestion = room.triviaQuestions[room.currentQuestionIndex];
      
      // Reveal the correct answer
      io.to(roomId).emit('question-ended', {
        correctIndex: currentQuestion.correctIndex
      });
      
      // Process all pending answers and award points
      const correctAnswers = room.pendingAnswers.filter(
        answer => answer.answerIndex === currentQuestion.correctIndex
      );
      
      // Award points for correct answers
      for (const answer of correctAnswers) {
        const participant = room.participants.find(p => p.id === answer.userId);
        if (participant) {
          // Calculate score based on time remaining
          const pointsEarned = Math.ceil(answer.timeRemaining * (20 / currentQuestion.timeLimit));
          participant.score += pointsEarned;
          
          console.log(`User ${answer.userId} earned ${pointsEarned} points`);
        }
      }
      
      // Check if there was any activity on this question
      if (room.pendingAnswers.length === 0) {
        room.inactivityCount++;
        console.log(`No answers received, inactivity count increased to: ${room.inactivityCount}`);
      } else {
        // Reset inactivity counter if there was activity
        room.inactivityCount = 0;
        room.questionHasActivity = true;
      }
      
      // Clear pending answers
      room.pendingAnswers = [];
      
      // Send updated scores to all clients
      io.to(roomId).emit('score-update', room.participants.map(p => ({
        userId: p.id,
        username: p.username,
        score: p.score
      })));
      
      // Wait a few seconds before moving to next question
      setTimeout(() => {
        nextTriviaQuestion(roomId);
      }, 3000);
    }
  }, 1000);
}

// End a trivia session
// In server.js - Update endTriviaSession
function endTriviaSession(roomId) {
  const room = activeRooms[roomId];
  if (!room) return;
  
  // Clean up break timer interval
  if (room.breakTimerInterval) {
    clearInterval(room.breakTimerInterval);
    room.breakTimerInterval = null;
  }
  
  // Reset trivia state
  room.triviaPaused = false;
  room.inactivityCount = 0;
  
  // Reset any timers and ensure clean state transition
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
  
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
      })),
      currentTopic: room.triviaCategory
    });
  }
}

// In server.js - Update the sendBreakTimeUpdate function
function sendBreakTimeUpdate(roomId) {
  const room = activeRooms[roomId];
  if (!room || room.currentMode !== 'trivia') return;
  
  // Calculate remaining break time
  const remainingTime = Math.max(0, Math.floor((room.breakEndTime - Date.now()) / 1000));
  
  // Send timer update
  io.to(roomId).emit('timer-update', {
    timeLeft: remainingTime,
    isRunning: true
  });
  
  // Check if break time is over
  if (remainingTime <= 0) {
    console.log("Break time is over, ending trivia session automatically");
    
    io.to(roomId).emit('trivia-message', {
      type: 'info',
      message: 'Break time is over, returning to study mode'
    });
    
    endTriviaSession(roomId);
    
    // Switch back to study mode with EXPLICIT timer state reset
    room.currentMode = 'study';
    room.timerValue = room.settings.studyTime;
    room.timerRunning = false; // Ensure this is explicitly set to false
    
    io.to(roomId).emit('mode-changed', room.currentMode);
    io.to(roomId).emit('timer-update', {
      timeLeft: room.timerValue,
      isRunning: false
    });
    
    // Clear this interval
    if (room.breakTimerInterval) {
      clearInterval(room.breakTimerInterval);
      room.breakTimerInterval = null;
    }
    
    return;
  }
  
  // If break time is almost over (10 seconds left), notify users
  if (remainingTime === 10) {
    io.to(roomId).emit('trivia-message', {
      type: 'info',
      message: 'Break ending in 10 seconds'
    });
  }
}

function cleanupRoomTimers(roomId) {
  const room = activeRooms[roomId];
  if (!room) return;
  
  console.log(`Cleaning up timers for room ${roomId}`);
  
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
  
  if (room.breakTimerInterval) {
    clearInterval(room.breakTimerInterval);
    room.breakTimerInterval = null;
  }
}

// Get predefined trivia questions for fallback
function getPredefinedTriviaQuestions(category, count = 5) {
  const generalKnowledge = [
    {
      id: uuidv4(),
      text: "What is the capital of France?",
      options: ["London", "Berlin", "Paris", "Madrid"],
      correctIndex: 2,
      timeLimit: 10
    },
    {
      id: uuidv4(),
      text: "Which planet is closest to the Sun?",
      options: ["Venus", "Mercury", "Mars", "Earth"],
      correctIndex: 1,
      timeLimit: 10
    },
    {
      id: uuidv4(),
      text: "What is the chemical symbol for gold?",
      options: ["Go", "Gd", "Au", "Ag"],
      correctIndex: 2,
      timeLimit: 10
    },
    {
      id: uuidv4(),
      text: "How many sides does a hexagon have?",
      options: ["5", "6", "7", "8"],
      correctIndex: 1,
      timeLimit: 10
    },
    {
      id: uuidv4(),
      text: "What is the largest ocean on Earth?",
      options: ["Atlantic", "Indian", "Arctic", "Pacific"],
      correctIndex: 3,
      timeLimit: 10
    }
  ];
  
  const popCulture = [
    {
      id: uuidv4(),
      text: "Which actor played Iron Man in the Marvel Cinematic Universe?",
      options: ["Chris Hemsworth", "Robert Downey Jr.", "Chris Evans", "Mark Ruffalo"],
      correctIndex: 1,
      timeLimit: 10
    },
    {
      id: uuidv4(),
      text: "What is the name of the fictional continent in Game of Thrones?",
      options: ["Essos", "Westeros", "Northeros", "Southeros"],
      correctIndex: 1,
      timeLimit: 10
    },
    {
      id: uuidv4(),
      text: "Which band performed the song 'Bohemian Rhapsody'?",
      options: ["The Beatles", "Queen", "Led Zeppelin", "AC/DC"],
      correctIndex: 1,
      timeLimit: 10
    },
    {
      id: uuidv4(),
      text: "Which movie franchise features a character named Harry Potter?",
      options: ["The Lord of the Rings", "Star Wars", "Harry Potter", "The Chronicles of Narnia"],
      correctIndex: 2,
      timeLimit: 10
    },
    {
      id: uuidv4(),
      text: "Who painted the Mona Lisa?",
      options: ["Vincent van Gogh", "Pablo Picasso", "Leonardo da Vinci", "Michelangelo"],
      correctIndex: 2,
      timeLimit: 10
    }
  ];
  
  // Select appropriate question set
  let questions = category === 'general' ? generalKnowledge : popCulture;
  
  // Return requested number of questions
  return questions.slice(0, count);
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