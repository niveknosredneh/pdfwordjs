 # KeyWord-PDF

A simple viewer for .pdf and .docx files that automatically searches documents upon open for a large pre-defined list of keywords and allows you to quickly jump between matches.

<img src="https://kvnhndrsn.github.io/projects/pdf.webp" height="400" align="middle">

## Install

```
# clone repo 
git clone https://github.com/kvnhndrsn/kwpdf
cd kwpdf/  

# nano keywords.json

# start python web server and open page
python3 -m http.server 8895 &   
xdg-open http://localhost:8895
```
## Imports

* **[PDFjs](https://mozilla.github.io/pdf.js/)** - PDF parsing
* **[jszip](https://stuk.github.io/jszip/)** - ZIP file support
* **[mammoth.js](https://github.com/mwilliamson/mammoth.js/)** - DOCX file support
* **[Tesseract.js](https://tesseract.projectnaptha.com/)** - OCR support


## Authors

* **Kevin Matthew Henderson**

## Contributors

## License

This project is licensed under the MIT License - see the [LICENSE.md](https://github.com/kvnhndrsn/kwpdf/blob/main/LICENSE.md) file for details
