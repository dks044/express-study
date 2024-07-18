const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
//app.use('/uploads', express.static('uploads'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// MongoDB 연결
mongoose.connect('mongodb://localhost:27017/oe_manuals');

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB 연결 에러:'));
db.once('open', () => {
    console.log('MongoDB에 연결되었습니다.');
});

// 메뉴얼 스키마 정의
const manualSchema = new mongoose.Schema({
    videoLink: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    order: { type: Number, required: true, unique: true },
    thumbnailPath: { type: String },
});

const Manual = mongoose.model('Manual', manualSchema);
const fs = require('fs').promises;


// Multer 설정
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        // 원래 파일 이름을 유지
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

// 이미지 업로드 라우트
app.post('/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('파일이 업로드되지 않았습니다.');
    }
    res.status(200).json({
        message: '파일 업로드 성공!',
        filePath: `/uploads/${req.file.filename}`
    });
});

// 메뉴얼 생성 라우트
app.post('/oe_manuals', upload.single('thumbnail'), async (req, res) => {
    const { videoLink, title, description, order } = req.body;
    const thumbnail = req.file;

    // 필수 데이터 검증
    if (!videoLink || !title || !description || !order) {
        return res.status(400).json({ message: '필수 필드가 누락되었습니다.' });
    }

    try {
        // 순서 중복 검증
        const existingManual = await Manual.findOne({ order: parseInt(order) });
        if (existingManual) {
            return res.status(409).json({ message: '해당 순서가 이미 존재합니다.' });
        }

        // 메뉴얼 데이터 생성
        const newManual = new Manual({
            videoLink,
            title,
            description,
            order: parseInt(order),
            //thumbnail: thumbnail.originalname,  // 원래 파일 이름 저장
            thumbnailPath: thumbnail ? `/uploads/${thumbnail.originalname}` : null,
        });

        // 데이터베이스에 저장
        await newManual.save();
        console.log('새 메뉴얼 생성:', newManual);

        res.status(201).json({ message: '메뉴얼 생성 성공', data: newManual });
    } catch (error) {
        console.error('메뉴얼 생성 중 오류 발생:', error);
        res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
});

// 메뉴얼 목록 가져오기 라우트
// mongoDB 특성 떄문에 _id를 id로 필드 교체
app.get('/oe_manuals', async (req, res) => {
    try {
        const manuals = await Manual.find();
        const formattedManuals = manuals.map(manual => ({
            ...manual.toObject(),
            id: manual._id,
            _id: undefined
        }));
        res.json(formattedManuals);
    } catch (error) {
        console.error('메뉴얼 목록 가져오는 중 오류 발생:', error);
        res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
});
//메뉴얼 하나 가져오기(id) 라우트
app.get('/oe_manuals/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const manual = await Manual.findById(id);
        if (!manual) {
            res.status(404).json({ message: '메뉴얼 데이터를 가져올 수 없습니다.' });
        }
        res.status(200).json(manual);
    } catch (error) {
        console.error('메뉴얼 삭제 중 오류 발생:', error);
        res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
});


// 메뉴얼 수정 라우트
// TODO: 이미지 삭제할떄 S3 객체 URL을 삭제할거라서 API만 받고 수정
app.put('/oe_manuals/:id', upload.single('thumbnail'), async (req, res) => {
    const { id } = req.params;
    const { order, title, videoLink, description } = req.body;
    const thumbnail = req.file ? `/uploads/${req.file.filename}` : null;

    // 필수 필드 검증
    if (!order || !title || !videoLink || !description) {
        return res.status(400).json({ message: '필수 필드가 누락되었습니다.' });
    }

    try {
        // 중복된 order 검증
        const existingManual = await Manual.findOne({ order: parseInt(order) });
        if (existingManual && existingManual._id.toString() !== id) {
            return res.status(409).json({ message: '해당 순서가 이미 존재합니다.' });
        }

        // 메뉴얼 업데이트
        const updateData = {
            order: parseInt(order),
            title,
            videoLink,
            description
        };

        //사용자가 수정폼에 썸네일을 넣었을경우
        if (thumbnail) {
            const originMenualRecord = await Manual.findById(id);
            const originThumbnailPath = path.join(__dirname, 'uploads', path.basename(originMenualRecord.thumbnailPath));
            //원래 있던 이미지 제거
            try {
                await fs.access(originThumbnailPath); // 파일 존재 여부 확인
                await fs.unlink(originThumbnailPath);
                console.log('썸네일 이미지 파일 삭제 성공:', originThumbnailPath);
            } catch (err) {
                console.error('썸네일 이미지 파일 삭제 중 오류 발생:', err);
            }
            updateData.thumbnailPath = thumbnail; // 썸네일 경로 업데이트
        }

        const updatedManual = await Manual.findByIdAndUpdate(id, updateData, { new: true });

        if (!updatedManual) {
            return res.status(404).json({ message: '메뉴얼을 찾을 수 없습니다.' });
        }

        res.status(200).json({ message: '메뉴얼 수정 성공', data: updatedManual });
    } catch (error) {
        console.error('메뉴얼 수정 중 오류 발생:', error);
        res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
});

// 메뉴얼 삭제 라우트
// TODO: 이미지 삭제할떄 S3 객체 URL을 삭제할거라서 API만 받으면됨.
app.delete('/oe_manuals/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const manual = await Manual.findById(id);
        if (!manual) {
            return res.status(404).json({ message: '메뉴얼을 찾을 수 없습니다.' });
        }

        const thumbnailPath = path.join(__dirname, 'uploads', path.basename(manual.thumbnailPath));
        console.log(`썸네일 경로: ${thumbnailPath}`);

        const deletedManual = await Manual.findByIdAndDelete(id);

        try {
            await fs.access(thumbnailPath); // 파일 존재 여부 확인
            await fs.unlink(thumbnailPath);
            console.log('썸네일 이미지 파일 삭제 성공:', thumbnailPath);
        } catch (err) {
            console.error('썸네일 이미지 파일 삭제 중 오류 발생:', err);
        }

        res.status(200).json({ message: '메뉴얼 삭제 성공', data: deletedManual });
    } catch (error) {
        console.error('메뉴얼 삭제 중 오류 발생:', error);
        res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
});

app.listen(port, () => {
    console.log(`서버가 http://localhost:${port} 에서 실행 중입니다.`);
});
