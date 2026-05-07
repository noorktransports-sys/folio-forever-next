'use client'

import { useState, useRef, useEffect } from 'react'

// Types
type PhotoUpload = {
  file: File
  preview: string
  id: string
  width: number
  height: number
  tagged: 'hero' | 'favorite' | 'none'
}

type PathType = 'engagement' | 'wedding' | 'family' | 'custom'

type EventGroup = {
  id: string
  name: string
  photos: PhotoUpload[]
}

type Step = 'path' | 'upload' | 'group' | 'tag' | 'pages' | 'adjust' | 'submit'

// Icon components
const IconUpload = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
  </svg>
)

const IconTag = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
  </svg>
)

const IconStar = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="currentColor" viewBox="0 0 20 20">
    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
  </svg>
)

const IconHeart = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
  </svg>
)

const IconCheck = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
)

const IconX = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
)

const IconArrowLeft = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
  </svg>
)

const IconArrowRight = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
  </svg>
)

export default function SmartDesignerPage() {
  const [step, setStep] = useState<Step>('path')
  const [pathType, setPathType] = useState<PathType | null>(null)
  const [photos, setPhotos] = useState<PhotoUpload[]>([])
  const [eventGroups, setEventGroups] = useState<EventGroup[]>([])
  const [pageCount, setPageCount] = useState(15)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Demo: Load sample wedding photos when path selected
  useEffect(() => {
    if (pathType === 'wedding' && photos.length === 0) {
      loadSampleWeddingPhotos()
    }
  }, [pathType])

  const loadSampleWeddingPhotos = async () => {
    setUploading(true)
    const samplePhotos: PhotoUpload[] = []

    // Simulate 20 wedding photos from picsum
    for (let i = 0; i < 20; i++) {
      const id = `sample-${i}`
      const preview = `https://picsum.photos/seed/wedding${i}/800/600`

      samplePhotos.push({
        file: new File([], `wedding-${i}.jpg`), // Dummy file
        preview,
        id,
        width: 800,
        height: 600,
        tagged: 'none'
      })
    }

    setPhotos(samplePhotos)
    setUploading(false)

    // Auto-create event groups
    setEventGroups([
      { id: 'prep', name: 'Getting Ready', photos: samplePhotos.slice(0, 5) },
      { id: 'ceremony', name: 'Ceremony', photos: samplePhotos.slice(5, 12) },
      { id: 'reception', name: 'Reception', photos: samplePhotos.slice(12, 20) }
    ])
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    if (photos.length + files.length > 100) {
      alert('Maximum 100 photos allowed')
      return
    }

    setUploading(true)
    const newPhotos: PhotoUpload[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]

      // Check resolution
      const dimensions = await getImageDimensions(file)
      if (dimensions.width < 3000 || dimensions.height < 3000) {
        alert(`${file.name} is below 3000x3000px minimum`)
        continue
      }

      newPhotos.push({
        file,
        preview: URL.createObjectURL(file),
        id: `${Date.now()}-${i}`,
        width: dimensions.width,
        height: dimensions.height,
        tagged: 'none'
      })
    }

    setPhotos([...photos, ...newPhotos])
    setUploading(false)
  }

  const getImageDimensions = (file: File): Promise<{ width: number; height: number }> => {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        resolve({ width: img.width, height: img.height })
      }
      img.src = URL.createObjectURL(file)
    })
  }

  const toggleTag = (photoId: string, tag: 'hero' | 'favorite') => {
    const heroCount = photos.filter(p => p.tagged === 'hero').length
    const favCount = photos.filter(p => p.tagged === 'favorite').length

    const photo = photos.find(p => p.id === photoId)
    if (!photo) return

    if (tag === 'hero' && photo.tagged !== 'hero' && heroCount >= 8) {
      alert('Maximum 8 hero photos')
      return
    }
    if (tag === 'favorite' && photo.tagged !== 'favorite' && favCount >= 30) {
      alert('Maximum 30 favorite photos')
      return
    }

    setPhotos(photos.map(p =>
      p.id === photoId
        ? { ...p, tagged: p.tagged === tag ? 'none' : tag }
        : p
    ))
  }

  const renderPathSelection = () => (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold">Smart Auto-Layout Designer</h1>
        <p className="text-lg text-gray-600">AI-powered album generation from your photos</p>
        <p className="text-sm text-orange-600 font-medium">⚡ BETA: Advanced layout engine in testing</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {[
          { type: 'engagement' as PathType, title: 'Engagement Session', desc: 'Romantic couple photos', icon: '💑' },
          { type: 'wedding' as PathType, title: 'Wedding Day', desc: 'Full ceremony & reception', icon: '💒' },
          { type: 'family' as PathType, title: 'Family Portrait', desc: 'Generations together', icon: '👨‍👩‍👧‍👦' },
          { type: 'custom' as PathType, title: 'Custom Event', desc: 'Any special occasion', icon: '🎉' }
        ].map((option) => (
          <button
            key={option.type}
            onClick={() => {
              setPathType(option.type)
              setStep('upload')
            }}
            className="p-8 border-2 border-gray-200 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all text-left group"
          >
            <div className="text-4xl mb-4">{option.icon}</div>
            <h3 className="text-xl font-semibold mb-2 group-hover:text-blue-600">{option.title}</h3>
            <p className="text-gray-600">{option.desc}</p>
          </button>
        ))}
      </div>
    </div>
  )

  const renderUpload = () => (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => setStep('path')} className="p-2 hover:bg-gray-100 rounded-lg">
          <IconArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-2xl font-bold">Upload Photos</h2>
          <p className="text-gray-600">Maximum 100 photos · Min 3000x3000px</p>
        </div>
      </div>

      <div
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-gray-300 rounded-xl p-16 text-center hover:border-blue-500 hover:bg-blue-50 transition-all cursor-pointer"
      >
        <IconUpload className="w-16 h-16 mx-auto mb-4 text-gray-400" />
        <p className="text-lg font-medium mb-2">Click to select photos</p>
        <p className="text-sm text-gray-500">or drag and drop here</p>
        <p className="text-xs text-gray-400 mt-4">{photos.length} / 100 photos uploaded</p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {photos.length > 0 && (
        <div className="grid grid-cols-4 gap-4">
          {photos.map((photo) => (
            <div key={photo.id} className="relative aspect-square rounded-lg overflow-hidden border-2 border-gray-200">
              <img src={photo.preview} alt="" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}

      {photos.length > 0 && (
        <button
          onClick={() => setStep('group')}
          className="w-full bg-blue-600 text-white py-4 rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          Continue to Event Grouping →
        </button>
      )}
    </div>
  )

  const renderGrouping = () => (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => setStep('upload')} className="p-2 hover:bg-gray-100 rounded-lg">
          <IconArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-2xl font-bold">Group Photos by Event</h2>
          <p className="text-gray-600">Organize photos into ceremony, reception, etc.</p>
        </div>
      </div>

      {eventGroups.map((group) => (
        <div key={group.id} className="border rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold">{group.name}</h3>
          <div className="grid grid-cols-6 gap-2">
            {group.photos.map((photo) => (
              <div key={photo.id} className="aspect-square rounded overflow-hidden">
                <img src={photo.preview} alt="" className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
          <p className="text-sm text-gray-500">{group.photos.length} photos</p>
        </div>
      ))}

      <button
        onClick={() => setStep('tag')}
        className="w-full bg-blue-600 text-white py-4 rounded-lg font-medium hover:bg-blue-700 transition-colors"
      >
        Continue to Tagging →
      </button>
    </div>
  )

  const renderTagging = () => {
    const heroCount = photos.filter(p => p.tagged === 'hero').length
    const favCount = photos.filter(p => p.tagged === 'favorite').length

    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => setStep('group')} className="p-2 hover:bg-gray-100 rounded-lg">
            <IconArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold">Tag Your Best Shots</h2>
            <p className="text-gray-600">AI will prioritize these in the layout</p>
          </div>
          <div className="flex gap-4 text-sm">
            <div className="flex items-center gap-2">
              <IconStar className="w-5 h-5 text-yellow-500" />
              <span className="font-medium">{heroCount} / 8 Heroes</span>
            </div>
            <div className="flex items-center gap-2">
              <IconHeart className="w-5 h-5 text-red-500" />
              <span className="font-medium">{favCount} / 30 Favorites</span>
            </div>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
          <p className="font-medium mb-1">💡 Tagging Guide:</p>
          <p><strong>Heroes</strong> (8 max): Full-spread worthy shots (kiss, first dance, family portrait)</p>
          <p><strong>Favorites</strong> (30 max): Important moments to feature prominently</p>
          <p><strong>Others</strong>: AI will use these to fill gaps and complete the story</p>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {photos.map((photo) => (
            <div key={photo.id} className="relative group">
              <div className={`
                aspect-square rounded-lg overflow-hidden border-2 transition-all
                ${photo.tagged === 'hero' ? 'border-yellow-500 ring-2 ring-yellow-200' : ''}
                ${photo.tagged === 'favorite' ? 'border-red-500 ring-2 ring-red-200' : ''}
                ${photo.tagged === 'none' ? 'border-gray-200' : ''}
              `}>
                <img src={photo.preview} alt="" className="w-full h-full object-cover" />
              </div>

              <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => toggleTag(photo.id, 'hero')}
                  className={`p-2 rounded-full ${
                    photo.tagged === 'hero'
                      ? 'bg-yellow-500 text-white'
                      : 'bg-white/90 text-gray-700 hover:bg-yellow-100'
                  }`}
                >
                  <IconStar className="w-4 h-4" />
                </button>
                <button
                  onClick={() => toggleTag(photo.id, 'favorite')}
                  className={`p-2 rounded-full ${
                    photo.tagged === 'favorite'
                      ? 'bg-red-500 text-white'
                      : 'bg-white/90 text-gray-700 hover:bg-red-100'
                  }`}
                >
                  <IconHeart className="w-4 h-4" />
                </button>
              </div>

              {photo.tagged !== 'none' && (
                <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/70 text-white text-xs rounded-full">
                  {photo.tagged === 'hero' ? '⭐ Hero' : '❤️ Favorite'}
                </div>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={() => setStep('pages')}
          disabled={heroCount === 0}
          className="w-full bg-blue-600 text-white py-4 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {heroCount === 0 ? 'Tag at least 1 hero to continue' : 'Continue to Page Count →'}
        </button>
      </div>
    )
  }

  const renderPageCount = () => {
    const basePrice = 450 // 10 spreads included
    const extraSpreads = Math.max(0, pageCount - 10)
    const extraCost = extraSpreads * 35
    const totalPrice = basePrice + extraCost

    return (
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => setStep('tag')} className="p-2 hover:bg-gray-100 rounded-lg">
            <IconArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold">Choose Album Length</h2>
            <p className="text-gray-600">Base price includes 10 spreads (20 pages)</p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <label className="text-lg font-medium">Number of Spreads</label>
            <span className="text-3xl font-bold text-blue-600">{pageCount}</span>
          </div>

          <input
            type="range"
            min="10"
            max="25"
            value={pageCount}
            onChange={(e) => setPageCount(parseInt(e.target.value))}
            className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${((pageCount - 10) / 15) * 100}%, #e5e7eb ${((pageCount - 10) / 15) * 100}%, #e5e7eb 100%)`
            }}
          />

          <div className="flex justify-between text-sm text-gray-500">
            <span>10 spreads</span>
            <span>25 spreads</span>
          </div>

          <div className="bg-gray-50 rounded-lg p-6 space-y-3">
            <div className="flex justify-between">
              <span>Base album (10 spreads)</span>
              <span className="font-medium">${basePrice}</span>
            </div>
            {extraSpreads > 0 && (
              <div className="flex justify-between text-blue-600">
                <span>{extraSpreads} extra spreads × $35</span>
                <span className="font-medium">+${extraCost}</span>
              </div>
            )}
            <div className="border-t pt-3 flex justify-between text-lg font-bold">
              <span>Total</span>
              <span className="text-blue-600">${totalPrice}</span>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
            <p><strong>AI Layout Rules:</strong></p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li>Heroes get full-spread layouts (2 pages)</li>
              <li>Favorites are paired (2 photos per spread)</li>
              <li>Other photos fill remaining space</li>
              <li>Algorithm optimizes for visual flow & story arc</li>
            </ul>
          </div>
        </div>

        <button
          onClick={() => setStep('adjust')}
          className="w-full bg-blue-600 text-white py-4 rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          Generate Layout Preview →
        </button>
      </div>
    )
  }

  const renderAdjust = () => (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => setStep('pages')} className="p-2 hover:bg-gray-100 rounded-lg">
          <IconArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold">Review & Adjust Layout</h2>
          <p className="text-gray-600">AI-generated preview · Drag to reorder before finalizing</p>
        </div>
        <button
          onClick={() => setStep('submit')}
          className="bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700 transition-colors"
        >
          Looks Great, Submit Order →
        </button>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-900 mb-6">
        <p className="font-medium">⚡ BETA Notice:</p>
        <p>AI layout engine in active testing. Preview shows rule-based placement. Drag-to-reorder coming in next update.</p>
      </div>

      {/* Mock spread previews */}
      <div className="space-y-8">
        {Array.from({ length: Math.min(3, pageCount) }).map((_, i) => (
          <div key={i} className="border-2 border-gray-300 rounded-lg p-4 bg-white">
            <div className="text-sm font-medium text-gray-500 mb-4">Spread {i + 1}</div>
            <div className="grid grid-cols-2 gap-4">
              <div className="aspect-[3/2] bg-gray-200 rounded flex items-center justify-center">
                <span className="text-gray-400">Page {i * 2 + 1}</span>
              </div>
              <div className="aspect-[3/2] bg-gray-200 rounded flex items-center justify-center">
                <span className="text-gray-400">Page {i * 2 + 2}</span>
              </div>
            </div>
          </div>
        ))}

        {pageCount > 3 && (
          <div className="text-center text-gray-500 text-sm">
            ... and {pageCount - 3} more spreads
          </div>
        )}
      </div>
    </div>
  )

  const renderSubmit = () => (
    <div className="max-w-2xl mx-auto text-center space-y-8 py-16">
      <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
        <IconCheck className="w-12 h-12 text-green-600" />
      </div>

      <div>
        <h2 className="text-3xl font-bold mb-4">Design Submitted!</h2>
        <p className="text-lg text-gray-600 mb-2">Your Smart Auto-Layout album is now in production queue</p>
        <p className="text-sm text-gray-500">Order #FF-{Date.now().toString().slice(-6)}</p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-left space-y-3">
        <h3 className="font-semibold text-blue-900">What happens next:</h3>
        <ul className="space-y-2 text-sm text-blue-800">
          <li className="flex items-start gap-3">
            <span className="font-bold">1.</span>
            <span>AI layout engine processes your tags and event groups</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="font-bold">2.</span>
            <span>Design team reviews the auto-generated layout</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="font-bold">3.</span>
            <span>You'll receive a final PDF proof within 48 hours</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="font-bold">4.</span>
            <span>After approval, printing begins (ships in 5-7 business days)</span>
          </li>
        </ul>
      </div>

      <div className="flex gap-4">
        <button
          onClick={() => {
            setStep('path')
            setPathType(null)
            setPhotos([])
            setEventGroups([])
            setPageCount(15)
          }}
          className="flex-1 border-2 border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors"
        >
          Start New Design
        </button>
        <button
          onClick={() => window.location.href = '/account/orders'}
          className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          View Order Status
        </button>
      </div>
    </div>
  )

  // Main render
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 py-12 px-4">
      {step === 'path' && renderPathSelection()}
      {step === 'upload' && renderUpload()}
      {step === 'group' && renderGrouping()}
      {step === 'tag' && renderTagging()}
      {step === 'pages' && renderPageCount()}
      {step === 'adjust' && renderAdjust()}
      {step === 'submit' && renderSubmit()}
    </div>
  )
}
