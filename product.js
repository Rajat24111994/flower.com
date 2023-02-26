
let API = "./flower.json"

// Localstorage 
let cart = JSON.parse(localStorage.getItem('cart')) || []
let wish = JSON.parse(localStorage.getItem('wish')) || []




// Fetching the data
// fetch(API)
//     .then((request) => request.json())
//     .then((data) => {
//         console.log(data.flower)
//         display(data.flower)
//         fetchandrender(data.flower)
//         // FilterData(data.flower)

//     })
let container = document.getElementById("container")


function display(data) {
    container.innerHTML = ""

    data.forEach((el, ind) => {

        // Creating 
        let box = document.createElement("div")
        let box2 = document.createElement("div")
        let box3 = document.createElement("div")
        let img = document.createElement("img")
        let title = document.createElement("h2")
        let price = document.createElement("h3")
        let btn = document.createElement("button")
        let btn2 = document.createElement("button")

        // Assigning Data
        img.src = el.image
        title.innerText = el.title
        price.innerText = `₹ ${el.price}`
        btn.innerText = "Add to Cart"
        btn2.innerText = "Add to Wish"

        // Clssess
        box.className = "box";
        box3.id = "wish";

        //Event Listner

        btn.addEventListener("click", () => {
            cart.push(el)
            localStorage.setItem("cart", JSON.stringify(cart))
            Swal.fire({
              position: 'center',
              icon: 'success',
              title: 'Product Added To Cart',
              showConfirmButton: false,
              timer: 1500
            })
        })
        btn2.addEventListener("click", () => {
            wish.push(el)
            localStorage.setItem("wish", JSON.stringify(wish))
            Swal.fire({
              position: 'center',
              icon: 'success',
              title: 'Product Added To Wishlist',
              showConfirmButton: false,
              timer: 1500
            })
        })

        // Appending to Main 
        box2.append(img)
        box3.append(btn, btn2)
        box.append(box2, title, price, box3)
        container.append(box)
    });
}


const selectElement = document.querySelector('.arrange');


function fetchandrender(Data) {
    selectElement.addEventListener('change', (event) => {
        let ans = selectElement.value;
        console.log(ans)
        if (ans == "asc-p") {
            Data.sort((a, b) => {
                return a.price - b.price
            })
        } else if (ans == "dsc-p") {
            Data.sort((a, b) => {
                return b.price - a.price
            })
        } else if (ans == "str-i") {
            Data.sort((a, b) => {
                const nameA = a.title.toUpperCase();
                const nameB = b.title.toUpperCase();
                if (nameA < nameB) {
                    return -1;
                } return 0;
            })
        }
        else if (ans == "str-d") {
            Data.sort((a, b) => {
                const nameA = a.title.toUpperCase();
                const nameB = b.title.toUpperCase();
                if (nameA > nameB) {
                    return -1;
                } return 0;

            })


        }else{
          return Data
        }

        // console.log(Data)
        // display(Data)
        FilterData(Data)
    });
}

let filterBy = document.getElementById("filter")
  filterBy.addEventListener("change", () => {
    FetchData()
  })


  function FilterData(data) {
    let filterValue = filterBy.value
    if (filterValue === "") {
      display(data)
    } else {
      data = data.filter((element) => {
        // it will return boolean value
        //
        return element.title== filterValue
      })
      display(data)
      console.log(data)
    }

  }

  async function FetchData() {
    try {
      let link = await fetch(API)
      link = await link.json()
    //   console.log(link)
      FilterData(link.flower)
      // display(link.flower)
      fetchandrender(link.flower)
      
    } catch (err) {
      console.log(err)
    }
  }

  FetchData()









  let user = document.querySelector(".signin");
  user.onclick = () => {
    location.href = "./login.html";
  };
  let order = document.querySelector(".orders");
  order.onclick = () => {
    location.href = "./wish.html";
  };
  // let shopnow = document.querySelector(".btn");
  // shopnow.onclick = () => {
  //   location.href = "./product.html";
  // };
  let bag = document.querySelector(".bag");
  bag.onclick = () => {
    location.href = "./cart.html";
  };
































// let filterBy = document.getElementById("filter")
// function FilterData(data) {
//     filterBy.addEventListener("change", (event) => {
//         let res = filterBy.value;
//         console.log(res)
//         if (res == "") {
//             display(data)

//             console.log(data)
//         } else if (res == "Basket Of Wishes") {
//             data = data.filter((element) => {
//                 return element.title == res
//             })
//             display(data)
//         }
//         else if (res == "Vibrant Spring Basket") {
//             data = data.filter((element) => {
//                 return element.title == res
//             })
//             display(data)
//         }
//         // display(data)
//         //   fetch()
//         // FilterData()
//         // FilterData(data.flower)
//     })
// }



// function FilterData(data) {
//   let filterValue = filterBy.value
//   if (filterValue === "") {
//     display(data)
//     console.log(data)
//   } else {
//     data = data.filter((element) => {
//       // it will return boolean value
//       return element.title == filterValue
//     })
//     display(data)
//   }

// }
