const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI is not defined.");
  console.error("Please set MONGODB_URI in Render.com environment variables.");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: 'secret_key_cms',
  resave: false,
  saveUninitialized: true
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Mongoose Models
const courseSchema = new mongoose.Schema({ name: String });
const Course = mongoose.model('Course', courseSchema);

const subjectSchema = new mongoose.Schema({ name: String, course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' } });
const Subject = mongoose.model('Subject', subjectSchema);

const userSchema = new mongoose.Schema({
  full_name: String,
  email: String,
  password: { type: String, default: '123456' },
  role: { type: String, enum: ['admin', 'staff', 'student'] },
  gender: String,
  address: String,
  profile_pic: { type: String, default: 'default.png' },
  course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  session_id: String
});
const User = mongoose.model('User', userSchema);

const attendanceSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  subject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
  course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  status: String,
  date: String
});
const Attendance = mongoose.model('Attendance', attendanceSchema);

const scoreSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  subject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
  score: Number
});
const Score = mongoose.model('Score', scoreSchema);

const leaveSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  role: String,
  date: String,
  message: String,
  status: { type: String, default: 'Pending' },
  created_at: { type: Date, default: Date.now }
});
const Leave = mongoose.model('Leave', leaveSchema);

const notificationSchema = new mongoose.Schema({
  message: String,
  type: String,
  created_at: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', notificationSchema);

const feedbackSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  message: String,
  created_at: { type: Date, default: Date.now }
});
const Feedback = mongoose.model('Feedback', feedbackSchema);

// Connect
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    console.log('Connected to MongoDB');
    initAdmin();
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

async function initAdmin() {
  const adminExists = await User.findOne({ role: 'admin' });
  if (!adminExists) {
    await User.create({
      email: 'admin@gmail.com',
      password: '123456',
      role: 'admin',
      full_name: 'Administrator'
    });
    console.log('Admin user created.');
  }
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

app.get('/', (req, res) => res.redirect('/app'));

app.get('/login', (req, res) => {
  res.render('login', { error: req.query.error });
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) {
      req.session.user = user;
      res.redirect('/app?page=dashboard');
    } else {
      res.redirect('/login?error=Invalid credentials');
    }
  } catch (err) {
    res.redirect('/login?error=Database Error');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

async function appHandler(req, res) {
  try {
    let success_msg = req.query.msg || '';
    let page = req.query.page || 'dashboard';
    const user = req.session.user;

    // Handle deletion
    if (req.method === 'GET' && req.query.delete && req.query.table && req.query.id) {
      const { table, id } = req.query;
      if (table === 'courses') await Course.findByIdAndDelete(id);
      else if (table === 'subjects') await Subject.findByIdAndDelete(id);
      else if (table === 'staff' || table === 'students') await User.findByIdAndDelete(id);
      return res.redirect(`/app?page=${page}&msg=Record deleted successfully.`);
    }

    if (req.method === 'POST') {
      const action = req.body.action;
      if (action === 'add_course') {
        await Course.create({ name: req.body.name });
        success_msg = 'Course added successfully.';
      } else if (action === 'add_subject') {
        await Subject.create({ name: req.body.name, course_id: req.body.course_id });
        success_msg = 'Subject added successfully.';
      } else if (action === 'add_staff') {
        await User.create({ ...req.body, role: 'staff' });
        success_msg = 'Staff added successfully.';
      } else if (action === 'add_student') {
        await User.create({ ...req.body, role: 'student' });
        success_msg = 'Student added successfully.';
      } else if (action === 'save_attendance') {
        const { date, course_id, subject_id, attendance } = req.body;
        await Attendance.deleteMany({ date, subject_id, course_id });
        if (attendance && typeof attendance === 'object') {
          const docs = Object.keys(attendance).map(student_id => ({
            student_id,
            subject_id,
            course_id,
            date,
            status: attendance[student_id]
          }));
          if (docs.length > 0) await Attendance.insertMany(docs);
        }
        success_msg = 'Attendance saved successfully.';
      } else if (action === 'save_scores') {
        const { subject_id, score } = req.body;
        if (score && typeof score === 'object') {
          for (let student_id of Object.keys(score)) {
            const val = score[student_id];
            if (val !== '') {
              await Score.findOneAndUpdate(
                { student_id, subject_id },
                { score: val },
                { upsert: true, new: true }
              );
            }
          }
        }
        success_msg = 'Scores saved successfully.';
      } else if (action === 'apply_leave') {
        await Leave.create({ user_id: user._id, role: user.role, date: req.body.date, message: req.body.message });
        success_msg = 'Leave applied successfully.';
      } else if (action === 'update_leave') {
        await Leave.findByIdAndUpdate(req.body.leave_id, { status: req.body.status });
        success_msg = 'Leave status updated successfully.';
      } else if (action === 'send_notification') {
        await Notification.create({ message: req.body.message, type: req.body.type });
        success_msg = 'Notification sent successfully.';
      } else if (action === 'send_feedback') {
        await Feedback.create({ student_id: user._id, message: req.body.message });
        success_msg = 'Feedback sent successfully.';
      }
      return res.redirect(`/app?page=${page}&msg=${success_msg}`);
    }

    const data = {
      user,
      page,
      success_msg,
      fetched_students: [],
      exam_students: [],
      existing_scores: {},
      existing_attendance: {},
      fetch_date: req.query.fetch_date || '',
      fetch_course: req.query.fetch_course || '',
      fetch_subject: req.query.fetch_subject || '',
      courses: [],
      subjects: []
    };

    data.courses = await Course.find();
    data.subjects = await Subject.find().populate('course_id');

    if (page === 'dashboard') {
      data.total_students = await User.countDocuments({ role: 'student' });
      data.total_staff = await User.countDocuments({ role: 'staff' });
      data.total_courses = await Course.countDocuments();
      data.total_subjects = await Subject.countDocuments();
      data.att_count = await Attendance.countDocuments();
      if (user.role === 'student') {
        data.total_present = await Attendance.countDocuments({ student_id: user._id, status: 'Present' });
        data.total_total = await Attendance.countDocuments({ student_id: user._id });
      }
    } else if (page === 'manage_staff') {
      data.staffs = await User.find({ role: 'staff' });
    } else if (page === 'manage_students') {
      data.students = await User.find({ role: 'student' }).populate('course_id');
    } else if (page === 'manage_attendance' || page === 'take_attendance') {
      if (req.query.fetch_course && req.query.fetch_date && req.query.fetch_subject) {
        data.fetched_students = await User.find({ role: 'student', course_id: req.query.fetch_course });
        const existingAtt = await Attendance.find({ date: req.query.fetch_date, subject_id: req.query.fetch_subject });
        existingAtt.forEach(att => {
          data.existing_attendance[att.student_id] = att.status;
        });
      }
    } else if (page === 'manage_exams') {
      if (req.query.fetch_course && req.query.fetch_subject) {
        data.exam_students = await User.find({ role: 'student', course_id: req.query.fetch_course });
        const existingScores = await Score.find({ subject_id: req.query.fetch_subject });
        existingScores.forEach(sc => {
          data.existing_scores[sc.student_id] = sc.score;
        });
      }
    } else if (page === 'notifications') {
      data.leaves = await Leave.find().populate('user_id').sort('-created_at');
    } else if (page === 'staff_notifs' || page === 'student_notifs') {
      const type = user.role;
      data.notifs = await Notification.find({ type }).sort('-created_at');
    } else if (page === 'apply_leave') {
      data.my_leaves = await Leave.find({ user_id: user._id }).sort('-created_at');
    } else if (page === 'view_attendance') {
      data.logs = await Attendance.find().populate('student_id subject_id').sort('-date').limit(50);
    } else if (page === 'my_attendance') {
      data.my_att = await Attendance.find({ student_id: user._id }).populate('subject_id').sort('-date');
    } else if (page === 'exam_results') {
      data.scores = await Score.find({ student_id: user._id }).populate('subject_id');
    }

    res.render('app', data);
  } catch (err) {
    console.error('Error in appHandler:', err);
    res.status(500).send("An error occurred while loading the page.");
  }
}

app.get('/app', requireAuth, appHandler);
app.post('/app', requireAuth, appHandler);

app.use((req, res) => {
  res.status(404).send(`Route Not Found: ${req.method} ${req.url}`);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
